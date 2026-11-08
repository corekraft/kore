import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";
import {
  issuerManifest,
  installLocalTrust,
  removeLocalTrustArtifacts,
} from "./trust.js";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CA issuer manifest references a generated secret and never embeds key material", () => {
  const manifest = issuerManifest("kore-local-ca", "kore-local-ca-key-pair");
  assert.match(manifest, /kind: ClusterIssuer/);
  assert.match(manifest, /secretName: kore-local-ca-key-pair/);
  assert.doesNotMatch(manifest, /BEGIN (RSA )?PRIVATE KEY/);
});

test("local trust installation ensures the target namespace exists", async () => {
  const repository = await loadRepository("local");
  const calls: {
    command: string;
    args: readonly string[];
    options?: RunOptions;
  }[] = [];
  const runner: Runner = {
    async run(
      command: string,
      args: readonly string[],
      options?: RunOptions,
    ): Promise<RunResult> {
      calls.push({ command, args, ...(options ? { options } : {}) });
      if (command === "minikube") {
        return { stdout: "{}", stderr: "", code: 0 };
      }
      if (command === "kubectl" && args.includes("jsonpath={.metadata.name}")) {
        return { stdout: "kube-system", stderr: "", code: 0 };
      }
      if (command === "mkcert" && args[0] === "-CAROOT") {
        return { stdout: "/tmp", stderr: "", code: 0 };
      }
      if (
        command === "kubectl" &&
        args.includes("create") &&
        args.includes("secret")
      ) {
        return {
          stdout: "apiVersion: v1\nkind: Secret\n",
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await installLocalTrust(repository, runner);

  assert.ok(
    calls.some(
      ({ command, args, options }) =>
        command === "kubectl" &&
        args.includes("--filename") &&
        options?.input?.includes("name: kore-system") &&
        options.input.includes("app.kubernetes.io/managed-by: Helm") &&
        options.input.includes(
          "meta.helm.sh/release-name: kore-platform-config",
        ),
    ),
  );
  assert.ok(
    calls.some(
      ({ command, args }) =>
        command === "kubectl" &&
        args.includes("create") &&
        args.includes("secret") &&
        args.includes("--namespace") &&
        args.includes("cert-manager"),
    ),
  );
  assert.ok(
    calls.some(
      ({ command, options }) =>
        command === "kubectl" &&
        options?.input?.includes("name: kore-local-ca"),
    ),
  );
  assert.ok(
    calls.some(
      ({ command, args }) =>
        command === "kubectl" &&
        args.includes("wait") &&
        args.includes("--for=condition=Ready") &&
        args.includes("clusterissuer/kore-local-ca"),
    ),
  );
});

test("trust installation rejects managed environments before side effects", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: { ...base.environment, provider: "managed" as const },
  };
  let calls = 0;
  const runner: Runner = {
    async run(): Promise<RunResult> {
      calls += 1;
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  await assert.rejects(
    installLocalTrust(repository, runner),
    /only valid for a Minikube environment/,
  );
  assert.equal(calls, 0);
});

test("trust installation fails closed when mkcert does not expose a CA root", async () => {
  const repository = await loadRepository("local");
  const runner: Runner = {
    async run(command: string, args: readonly string[]): Promise<RunResult> {
      if (command === "minikube") {
        return { stdout: "{}", stderr: "", code: 0 };
      }
      if (command === "kubectl" && args.includes("jsonpath={.metadata.name}")) {
        return { stdout: "kube-system", stderr: "", code: 0 };
      }
      if (command === "mkcert" && args[0] === "-CAROOT") {
        return { stdout: "  \n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  await assert.rejects(
    installLocalTrust(repository, runner),
    /did not return its CA root/,
  );
});

test("removes the temporary CA artifact directory for the selected environment", async () => {
  const environment = `test-${process.pid}`;
  const artifacts = join(tmpdir(), `kore-ca-${environment}`);
  await mkdir(artifacts, { recursive: true });
  try {
    await removeLocalTrustArtifacts({
      environment: { name: environment },
    } as never);
    await assert.rejects(stat(artifacts), { code: "ENOENT" });
  } finally {
    await rm(artifacts, { recursive: true, force: true });
  }
});
