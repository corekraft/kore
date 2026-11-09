import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository } from "../config/index.js";
import { findRoot } from "../config/config.js";
import { ProcessRunner } from "../runtime/index.js";
import {
  admissionGateName,
  admissionGateResource,
  readAdmissionGate,
} from "./admission-gate.js";
import {
  assertRbac,
  kubectl,
  proveAdmission,
} from "./gate-integration-support.js";

// Docs: docs/decisions/0067-platform-readiness-manifest-and-evidence.md
// Live and opt-in (`npm run test:integration:gate`, KORE_RUN_INTEGRATION=1):
// needs a converged local profile (`kore local up`). It proves, with
// impersonated non-administrator identities (`kubectl --as`):
//   1. who can and cannot write the gate, readiness evidence and activation;
//   2. that the shared KoreApplicationAdmission template DENIES application
//      workloads while a gate is closed and admits them once it opens, and
//      that cluster controllers are not blocked while closed.
// Part 2 uses a throwaway constraint of the same template, scoped to a
// throwaway namespace and set to `deny`, so the platform's own gate is never
// touched and stays in `dryrun` (promoting it is a separate, deliberate
// change). Every admission request is a server dry-run; no workload is
// created, no Secret is read, and the only image is catalog-approved.

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
      : false,
  timeout: 10 * 60 * 1000,
};

test(
  "non-administrators cannot write the gate, evidence or activation, and a closed gate denies application workloads until bootstrap opens it",
  live,
  async () => {
    const repository = await loadRepository("local", await findRoot());
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);
    const cluster = { repository, runner };
    const image = repository.approved.images[0]?.image;
    assert.ok(image, "the catalog approves at least one image");
    const before = await readAdmissionGate(repository, runner);
    assert.ok(before, "run kore local up first: the platform gate must exist");

    await assertRbac(cluster);
    await proveAdmission(cluster, image);

    // The platform's own gate was never touched, and is still audit-only.
    assert.deepEqual(await readAdmissionGate(repository, runner), before);
    const enforcement = await kubectl(cluster, [
      "get",
      admissionGateResource,
      admissionGateName,
      "--output",
      "jsonpath={.spec.enforcementAction}",
    ]);
    process.stderr.write(
      `platform gate enforcementAction is ${enforcement.output}; promotion to deny is a separate change (ADR 0067)\n`,
    );
  },
);
