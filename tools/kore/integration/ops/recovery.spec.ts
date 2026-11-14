import assert from "node:assert/strict";
import { test } from "vitest";
import { findRoot, loadRepository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { opsReport } from "../../src/ops/index.js";

// Real files and real units together: the recovery objectives of this
// repository, read through the ops barrel. Unit tests of recovery.ts live beside
// it in src/ops.

const noProcesses: Runner = {
  run: () => Promise.reject(new Error("the recovery check starts no process")),
};

test("this repository's recovery objectives cover every stateful component", async () => {
  const root = await findRoot();
  const { report, ok } = await opsReport("recovery", {
    repository: await loadRepository("local", root),
    runner: noProcesses,
    json: false,
  });
  assert.equal(ok, true);
  assert.deepEqual(report["problems"], []);
  const stateful = report["stateful"] as string[];
  for (const name of [
    "prometheus",
    "loki",
    "grafana",
    "tempo",
    "kore-observability-config",
    "oci-registry",
    "kore-postgresql-api",
  ]) {
    assert.ok(stateful.includes(name), `${name} is detected as stateful`);
  }
});
