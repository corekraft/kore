import assert from "node:assert/strict";
import { test } from "vitest";
import { localRegistryReference } from "./registry.js";
import type { Runner } from "./runner.js";

test("local registry verification starts a host-side port forward", async () => {
  const calls: { command: string; args: readonly string[]; input: string | undefined }[] = [];
  let portChecks = 0;
  const runner: Runner = {
    async run(command, args, options) {
      calls.push({ command, args, input: options?.input });
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  const reference = await localRegistryReference({
    kubeContext: "kore-local",
    environment: { provider: "minikube", kubeContext: "kore-local", cluster: { profile: "kore-local" } },
  } as never, runner, "registry.kore.local:30500/reference@sha256:" + "a".repeat(64), {
    spawnPortForward: (repository) => {
      calls.push({ command: "kubectl", args: ["--context", repository.environment.kubeContext, "--namespace", "kore-registry", "port-forward", "service/oci-registry", "30500:5000"], input: undefined });
      return 1234;
    },
    isPortOpen: async () => portChecks++ > 0,
  });
  assert.equal(reference, "127.0.0.1:30500/reference@sha256:" + "a".repeat(64));
  assert.deepEqual(calls[0]!.args, ["--context", "kore-local", "--namespace", "kore-registry", "port-forward", "service/oci-registry", "30500:5000"]);
});
