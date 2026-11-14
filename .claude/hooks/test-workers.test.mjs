// The unit-test worker cap defaults to two and takes an env override, so no
// unit path (hook, npm test, mise run test) can start a worker per core. Both
// vitest configs run the threads pool with that cap (ADR 0106, #405).
// Docs: docs/guides/contributor.md (Commit hooks)

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "./node-test-shim.mjs";

const { testWorkers } = await import(
  fileURLToPath(
    new URL("../../tools/kore/.husky/test-workers.mjs", import.meta.url),
  )
);

test("the default is two workers whatever the host, so a live cluster keeps its cores", () => {
  assert.equal(testWorkers({}), 2);
});

test("KORE_TEST_WORKERS overrides the default on a local host", () => {
  assert.equal(testWorkers({ KORE_TEST_WORKERS: "6" }), 6);
  assert.equal(testWorkers({ KORE_TEST_WORKERS: "2" }), 2);
});

test("an unusable override fails naming the variable instead of running uncapped", () => {
  for (const bad of ["0", "-1", "many", "1.5", ""]) {
    assert.throws(
      () => testWorkers({ KORE_TEST_WORKERS: bad }),
      /KORE_TEST_WORKERS must be a positive whole number/,
      bad,
    );
  }
});

test("both packages' vitest configs apply the cap on the threads pool", async () => {
  const cap = testWorkers();
  for (const path of [
    "../../tools/kore/vitest.config.ts",
    "../../tools/harness/vitest.config.ts",
  ]) {
    const { default: config } = await import(
      fileURLToPath(new URL(path, import.meta.url))
    );
    assert.equal(config.test.pool, "threads", path);
    assert.equal(config.test.maxWorkers, cap, path);
  }
});
