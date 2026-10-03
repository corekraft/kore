import { expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRepository } from "../config/index.js";
import {
  appStatus,
  appDown,
  appUp,
  deploymentListArgs,
  deploymentRolloutStatusArgs,
  imageReleaseArgs,
  localMinikubeImageReference,
  minikubeImagePullArgs,
  localImagePullPolicyArgs,
  verifyLockedImageArgs,
} from "./app.js";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";

class UnreadyPlatformRunner implements Runner {
  calls: string[] = [];

  async run(
    command: string,
    args: readonly string[],
    _options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push(`${command} ${args.join(" ")}`);
    if (command === "helm" && args[0] === "status") {
      throw new Error("release is missing");
    }
    if (command === "minikube" && args[0] === "status") {
      return { stdout: '{"Host":"Running"}', stderr: "", code: 0 };
    }
    if (command === "kubectl") {
      return { stdout: "kube-system", stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  }
}

test("app up stops before installing resources when the platform is not ready", async () => {
  const repository = await loadRepository("local");
  const runner = new UnreadyPlatformRunner();

  await expect(appUp(repository, runner, "reference")).rejects.toThrow(
    /platform.*ready|missing/i,
  );
  expect(runner.calls.some((call) => call.includes(" upgrade "))).toBe(false);
});

test("app up verifies, installs, and waits for every workload deployment", async () => {
  const repository = await loadRepository("local");
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      if (command === "helm" && args[0] === "status")
        return {
          stdout: '{"info":{"status":"deployed"}}',
          stderr: "",
          code: 0,
        };
      if (
        command === "kubectl" &&
        args.some((arg) => arg.includes("spec.clusterIP"))
      )
        return { stdout: "10.0.0.8", stderr: "", code: 0 };
      if (command === "kubectl" && args.includes("--output=name"))
        return {
          stdout:
            "deployment/reference-api\ndeployment.apps/reference-worker\n",
          stderr: "",
          code: 0,
        };
      if (command === "kubectl" && args.includes("namespace"))
        return { stdout: "kube-system", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  const image = {
    reference: "registry.kore.local:30500/reference@sha256:" + "a".repeat(64),
    digest: "sha256:" + "a".repeat(64),
    signer: "local-kore-key",
  };
  localRegistryReferenceMock.mockImplementation(
    async (_repository, _runner, reference) => reference,
  );

  await appUp(repository, runner, "reference", image, "/tmp/kore.pub");

  expect(
    calls.some(
      ({ command, args }) => command === "cosign" && args[0] === "verify",
    ),
  ).toBe(true);
  expect(
    calls.some(
      ({ command, args }) => command === "minikube" && args[0] === "ssh",
    ),
  ).toBe(true);
  expect(
    calls
      .filter(
        ({ command, args }) => command === "helm" && args[0] === "upgrade",
      )
      .map(({ args }) => args[2]),
  ).toEqual(["reference-resources", "reference"]);
  expect(
    calls
      .filter(
        ({ command, args }) =>
          command === "kubectl" && args.includes("rollout"),
      )
      .map(({ args }) => args[args.indexOf("status") + 1]),
  ).toEqual(["deployment/reference-api", "deployment/reference-worker"]);
});

test("app down uninstalls the named workload release", async () => {
  const repository = await loadRepository("local");
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      if (command === "kubectl")
        return { stdout: "kube-system", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await appDown(repository, runner, "reference");

  expect(calls.at(-1)).toEqual({
    command: "helm",
    args: [
      "uninstall",
      "reference",
      "--namespace=reference",
      "--kube-context",
      "kore-local",
      "--wait",
      "--timeout=10m",
    ],
  });
});

test("workload release uses the immutable locked image reference", async () => {
  const repository = await loadRepository("local");
  expect(
    imageReleaseArgs(repository, "reference", {
      reference: "registry.kore.local/reference@sha256:" + "a".repeat(64),
      digest: "sha256:" + "a".repeat(64),
      signer: "release@kore.dev",
    }),
  ).toEqual([
    "--set-string",
    "image.repository=registry.kore.local/reference",
    "--set-string",
    "image.digest=sha256:" + "a".repeat(64),
  ]);
});

test("image verification is bound to the locked signer and digest", () => {
  expect(
    verifyLockedImageArgs({
      reference: "registry.kore.local/reference@sha256:" + "a".repeat(64),
      digest: "sha256:" + "a".repeat(64),
      signer: "release@kore.dev",
    }),
  ).toEqual([
    "verify",
    "--certificate-identity",
    "release@kore.dev",
    "--certificate-oidc-issuer",
    "https://token.actions.githubusercontent.com",
    "registry.kore.local/reference@sha256:" + "a".repeat(64),
  ]);
});

test("HTTP local registry verification uses its explicit NodePort", () => {
  expect(
    verifyLockedImageArgs({
      reference: "registry.kore.local:30500/reference@sha256:" + "a".repeat(64),
      digest: "sha256:" + "a".repeat(64),
      signer: "release@kore.dev",
    }),
  ).toEqual([
    "verify",
    "--allow-http-registry",
    "--certificate-identity",
    "release@kore.dev",
    "--certificate-oidc-issuer",
    "https://token.actions.githubusercontent.com",
    "registry.kore.local:30500/reference@sha256:" + "a".repeat(64),
  ]);
});

test("local image verification uses the generated public key", () => {
  expect(
    verifyLockedImageArgs(
      {
        reference: "127.0.0.1:30500/reference@sha256:" + "a".repeat(64),
        digest: "sha256:" + "a".repeat(64),
        signer: "local-kore-key",
      },
      "/workspace/.kore/keys/local/kore.pub",
    ),
  ).toEqual([
    "verify",
    "--allow-http-registry",
    "--insecure-ignore-tlog",
    "--key",
    "/workspace/.kore/keys/local/kore.pub",
    "127.0.0.1:30500/reference@sha256:" + "a".repeat(64),
  ]);
});

test("Minikube stages the locked digest under the registry service reference", () => {
  const reference = localMinikubeImageReference(
    "registry.kore.local:30500/reference@sha256:" + "a".repeat(64),
    "10.102.135.66",
  );
  expect(reference).toBe(
    "10.102.135.66:5000/reference@sha256:" + "a".repeat(64),
  );
  expect(minikubeImagePullArgs("kore-local", reference)).toEqual([
    "ssh",
    "--profile",
    "kore-local",
    "--",
    `sudo nerdctl --insecure-registry --namespace k8s.io pull ${reference}`,
  ]);
});

test("local workload releases never pull the already-loaded image", () => {
  expect(localImagePullPolicyArgs()).toEqual([
    "--set-string",
    "image.pullPolicy=Never",
  ]);
});

test("deployment rollout status targets a named deployment", () => {
  expect(deploymentRolloutStatusArgs("reference")).toEqual([
    "rollout",
    "status",
    "deployment/reference",
    "--timeout=10m",
  ]);
});

test("deployment discovery uses kubectl get", () => {
  expect(deploymentListArgs()).toEqual(["get", "deployment", "--output=name"]);
});

test("reference resources template evaluates database values with Helm delimiters", async () => {
  const repository = await loadRepository("local");
  const template = await readFile(
    join(
      repository.root,
      "apps/reference/charts/resources/templates/resources.yaml",
    ),
    "utf8",
  );

  expect(template).not.toContain("{ {");
  expect(template).toContain("{{ .Values.database.retentionPolicy | quote }}");
  expect(template).toContain(
    "compatibilityVersion: {{ .Values.database.compatibilityVersion }}",
  );
});

test("reference workload pins the non-root UID for Kubernetes runtime validation", async () => {
  const repository = await loadRepository("local");
  const template = await readFile(
    join(
      repository.root,
      "apps/reference/charts/workload/templates/workloads.yaml",
    ),
    "utf8",
  );

  expect(template).toContain("runAsUser: 1000");
  expect(template).toContain("runAsGroup: 1000");
});

test("app status reports locked image provenance", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-app-status-"));
  await mkdir(join(root, "infra/catalog"), { recursive: true });
  await copyFile(
    join(base.root, "infra/catalog/images.lock.json"),
    join(root, "infra/catalog/images.lock.json"),
  );
  const repository = { ...base, root };
  const runner: Runner = {
    async run(command, _args) {
      if (command === "kubectl")
        return { stdout: "kube-system", stderr: "", code: 0 };
      if (command === "helm")
        return {
          stdout: '{"info":{"status":"deployed"}}',
          stderr: "",
          code: 0,
        };
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  try {
    const status = await appStatus(repository, runner, "reference");
    expect(status.image).toEqual({
      reference:
        "registry.kore.local:30500/reference@sha256:76eae6c0774b5292f70e3541e57bd8f2b4df2e5f74aacaba258fed9fa894b3bc",
      digest:
        "sha256:76eae6c0774b5292f70e3541e57bd8f2b4df2e5f74aacaba258fed9fa894b3bc",
      signer: "local-kore-key",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
