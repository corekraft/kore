import { afterEach, expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));
import { loadRepository } from "../config/index.js";
import { appUp, appUpRelease } from "./up.js";

afterEach(removeReleaseLocks);
import {
  healthyReadinessOutput,
  healthyRunner,
  lockedImage,
  passthroughRegistry,
  releaseNotFound,
  releaseSigner,
  removeReleaseLocks,
  writeReleaseLock,
  type Call,
} from "./app-fixtures.js";
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

  await expect(
    appUpRelease(
      repository,
      runner,
      "reference",
      await writeReleaseLock(repository.root),
    ),
  ).rejects.toThrow(/platform.*ready|missing/i);
  expect(runner.calls.some((call) => call.includes(" upgrade "))).toBe(false);
});

const deployedStatus = {
  stdout: '{"info":{"status":"deployed"}}',
  stderr: "",
  code: 0,
};

test("app up verifies, installs, and waits for every workload deployment", async () => {
  const repository = await loadRepository("local");
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      releaseNotFound(command, args);
      if (command === "helm" && args[0] === "status") {
        return deployedStatus;
      }
      if (command === "kubectl" && healthyReadinessOutput(args) !== undefined) {
        return { stdout: healthyReadinessOutput(args)!, stderr: "", code: 0 };
      }
      if (
        command === "kubectl" &&
        args.some((arg) => arg.includes("spec.clusterIP"))
      ) {
        return { stdout: "10.96.0.50", stderr: "", code: 0 };
      }
      if (command === "kubectl" && args.includes("--output=name")) {
        return {
          stdout:
            "deployment/reference-api\ndeployment.apps/reference-worker\n",
          stderr: "",
          code: 0,
        };
      }
      if (command === "kubectl" && args.includes("namespace")) {
        return { stdout: "kube-system", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  const image = {
    reference: "registry.kore.local:30500/reference@sha256:" + "a".repeat(64),
    digest: "sha256:" + "a".repeat(64),
    signer: "local-kore-key",
  };
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUp(repository, runner, "reference", image, {
    publicKey: "/tmp/kore.pub",
  });

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
      .map(({ args }) => args[args.indexOf("status") + 1])
      .filter((resource) => resource?.startsWith("deployment/reference-")),
  ).toEqual(["deployment/reference-api", "deployment/reference-worker"]);
});

const upCalls = (calls: Call[], command: string, verb: string) =>
  calls.filter((c) => c.command === command && c.args.includes(verb));

test("app up fails before staging or installing when the local registry has no ClusterIP", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await expect(
    appUp(repository, healthyRunner(calls, "  "), "reference", lockedImage(), {
      publicKey: "/tmp/kore.pub",
    }),
  ).rejects.toThrow(/no ClusterIP/);
  expect(
    calls.some((c) => c.command === "minikube" && c.args[0] === "ssh"),
  ).toBe(false);
  expect(upCalls(calls, "helm", "upgrade")).toEqual([]);
});

test("app up does not install anything when image verification fails", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const runner = healthyRunner(
    calls,
    "10.96.0.50",
    (c) => c.command === "cosign",
  );

  await expect(
    appUp(repository, runner, "reference", lockedImage(), {
      publicKey: "/tmp/kore.pub",
    }),
  ).rejects.toThrow(/cosign failed/);
  expect(
    calls.some((c) => c.command === "minikube" && c.args[0] === "ssh"),
  ).toBe(false);
  expect(upCalls(calls, "helm", "upgrade")).toEqual([]);
});

test("app up verifies keylessly against the locked signer when the image is not locally signed", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUpRelease(
    repository,
    healthyRunner(calls),
    "reference",
    await writeReleaseLock(repository.root),
  );

  const verify = calls.find((c) => c.command === "cosign");
  expect(verify?.args).toContain(releaseSigner);
  expect(verify?.args).not.toContain("--key");
});

test("app up verifies the registry-resolved reference but deploys the staged cluster-local reference", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  localRegistryReferenceMock.mockImplementation(
    async () => "127.0.0.1:30500/reference@" + lockedImage().digest,
  );

  await appUp(repository, healthyRunner(calls), "reference", lockedImage(), {
    publicKey: "/tmp/kore.pub",
  });

  const verify = calls.find((c) => c.command === "cosign");
  expect(verify?.args.at(-1)).toBe(
    "127.0.0.1:30500/reference@" + lockedImage().digest,
  );
  const workload = upCalls(calls, "helm", "upgrade")[1]!;
  expect(workload.args).toContain("image.repository=10.96.0.50:5000/reference");
  expect(workload.args).toContain("image.pullPolicy=Never");
});

test("app up waits for databases and secrets before installing the workload", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUp(repository, healthyRunner(calls), "reference", lockedImage(), {
    publicKey: "/tmp/kore.pub",
  });

  const lines = calls.map((c) => `${c.command} ${c.args.join(" ")}`);
  // Skip the platform readiness probes that run before the workload install.
  const steps = lines
    .slice(
      lines.findIndex((c) =>
        c.startsWith("helm upgrade --install reference-resources"),
      ),
    )
    .filter((c) => /upgrade|wait --for|rollout/.test(c));
  expect(steps).toEqual([
    expect.stringMatching(/^helm upgrade --install reference-resources /),
    expect.stringMatching(/postgresqlinstances.platform.kore.dev --all/),
    expect.stringMatching(
      /--for=jsonpath=\{.data\} secret .*part-of=reference/,
    ),
    expect.stringMatching(/^helm upgrade --install reference /),
    expect.stringMatching(/rollout status deployment\/reference-api/),
    expect.stringMatching(/rollout status deployment\/reference-worker/),
  ]);
});

test("app up on a managed provider deploys the locked reference without staging", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: { ...base.environment, provider: "managed" as const },
  };
  const calls: Call[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await appUpRelease(
    repository,
    healthyRunner(calls),
    "reference",
    await writeReleaseLock(repository.root),
  );

  expect(
    calls.some((c) => c.command === "minikube" && c.args[0] === "ssh"),
  ).toBe(false);
  const workload = upCalls(calls, "helm", "upgrade")[1]!;
  expect(workload.args).toContain(
    "image.repository=registry.kore.local:30500/reference",
  );
  expect(workload.args).not.toContain("image.pullPolicy=Never");
});

test("app up fails with the fix when the registry Service is not at registry.address", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);

  await expect(
    appUp(
      repository,
      healthyRunner(calls, "10.99.1.2"),
      "reference",
      lockedImage(),
      { publicKey: "/tmp/kore.pub" },
    ),
  ).rejects.toThrow(
    /10\.99\.1\.2.*registry\.address 10\.96\.0\.50:5000.*kore platform up/s,
  );
  expect(upCalls(calls, "helm", "upgrade")).toEqual([]);
});
