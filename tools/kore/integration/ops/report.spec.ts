import assert from "node:assert/strict";
import { test } from "vitest";
import { findRoot, loadRepository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { opsReport } from "../../src/ops/index.js";

// Real files and real units together, through the ops barrel: this repository's
// inventory and the dispatch of unknown actions. Unit tests of report.ts live
// beside it in src/ops.

const noProcesses: Runner = {
  run: () => Promise.reject(new Error("the inventory starts no process")),
};

test("inventory reports counts and passes on this repository", async () => {
  const { report, ok } = await opsReport("inventory", {
    repository: await loadRepository("local", await findRoot()),
    runner: noProcesses,
    json: false,
  });
  assert.equal(ok, true);
  const counts = report["counts"] as Record<string, number>;
  assert.ok(counts["component"]! > 0 && counts["npm"]! > 0);
  assert.equal("items" in report, false);
});

test("inventory --json carries every item for review", async () => {
  const { report } = await opsReport("inventory", {
    repository: await loadRepository("local", await findRoot()),
    runner: noProcesses,
    json: true,
  });
  assert.ok((report["items"] as unknown[]).length > 100);
});

test("an unknown action is rejected with the supported list", async () => {
  await assert.rejects(
    opsReport("nope", {
      repository: await loadRepository("local", await findRoot()),
      runner: noProcesses,
      json: false,
    }),
    /unknown ops action nope; use inventory, recovery, upgrade-check, or crd-check/,
  );
});
