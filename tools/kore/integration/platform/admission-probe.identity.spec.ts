import assert from "node:assert/strict";
import { loadRepository } from "../../src/config/index.js";
import { test } from "vitest";
import type { Call } from "../../src/testing/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { admissionVerdict, scaleDeployment } from "../../src/platform/index.js";

// Docs: docs/decisions/0028-image-trust-authority.md
// The scale and ServiceAccount probes, which the admission catalog spec shares a source with.

const source = `10.96.0.50:5000/reference@sha256:${"c".repeat(64)}`;

test("scaling names the environment context and namespace, never the current context", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await scaleDeployment(repository, runner, "kore-registry", "oci-registry", 0);

  assert.deepEqual(calls[0]!.args, [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    "kore-registry",
    "scale",
    "deployment/oci-registry",
    "--replicas=0",
  ]);
  assert.equal(
    calls.length,
    1,
    "scaling is one mutation; waiting is the caller's",
  );
});

test("a probe can name the ServiceAccount its pod uses, so identity policy can be probed", async () => {
  const repository = await loadRepository("local");
  let body = "";
  const runner: Runner = {
    async run(_command, _args, options) {
      body = options?.input ?? "";
      return { stdout: "pod/x created (server dry run)", stderr: "", code: 0 };
    },
  };

  await admissionVerdict(repository, runner, "reference", source, {
    serviceAccountName: "default",
  });

  assert.equal(JSON.parse(body).spec.serviceAccountName, "default");
});

test("a probe without a ServiceAccount option leaves the pod spec unchanged", async () => {
  const repository = await loadRepository("local");
  let body = "";
  const runner: Runner = {
    async run(_command, _args, options) {
      body = options?.input ?? "";
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await admissionVerdict(repository, runner, "reference", source);

  assert.equal("serviceAccountName" in JSON.parse(body).spec, false);
});
