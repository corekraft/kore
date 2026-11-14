// The unit-run speed settings that keep each package under the 20 s unit-run
// budget (ADR 0098, plan 14): worker threads, not forked processes, and a CI
// worker cap matching the runner's four cores. A config that drops either
// fails here, naming the setting.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

test("both packages' unit runs use worker threads, which start faster and use about a third less CPU than forked processes", async () => {
  for (const path of [
    "../vitest.config.ts",
    "../../harness/vitest.config.ts",
  ]) {
    // The configs import TypeScript, which plain node cannot load, so read the text.
    const config = await readFile(here(path), "utf8");
    assert.match(config, /^\s+pool: "threads",$/m, path);
  }
});

test("CI sets its own worker cap to the four cores of its public runner, so the unit-run budget has headroom", async () => {
  const workflow = await readFile(
    here("../../../.github/workflows/check.yml"),
    "utf8",
  );
  assert.match(workflow, /^\s+KORE_TEST_WORKERS: "4"$/m);
});
