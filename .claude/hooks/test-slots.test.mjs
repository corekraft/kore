// How many commit-hook test runs may share a host: sized to the cores and the
// current load average, so a busy host admits fewer and an idle one more.
// Docs: docs/guides/contributor.md (Commit hooks)

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "./node-test-shim.mjs";

const { slotCount } = await import(
  fileURLToPath(
    new URL("../../tools/kore/.husky/test-slots.mjs", import.meta.url),
  )
);

test("an idle host admits one run per pair of cores", () => {
  assert.equal(slotCount({ env: {}, cores: 12, load: 0 }), 6);
});

test("load takes slots away: each busy core-pair is one run fewer", () => {
  assert.equal(slotCount({ env: {}, cores: 12, load: 6 }), 3);
  assert.equal(slotCount({ env: {}, cores: 12, load: 9.5 }), 1);
});

test("a saturated or tiny host still admits one run, so a commit is never starved", () => {
  assert.equal(slotCount({ env: {}, cores: 12, load: 40 }), 1);
  assert.equal(slotCount({ env: {}, cores: 1, load: 0 }), 1);
});

test("more workers per run means fewer runs at once", () => {
  assert.equal(
    slotCount({ env: { KORE_TEST_WORKERS: "4" }, cores: 12, load: 0 }),
    3,
  );
});

test("KORE_TEST_SLOTS fixes the size whatever the load", () => {
  assert.equal(
    slotCount({ env: { KORE_TEST_SLOTS: "5" }, cores: 2, load: 9 }),
    5,
  );
});

test("a bad KORE_TEST_SLOTS is named and rejected, never read as one slot", () => {
  for (const bad of ["0", "-1", "two", "1.5"]) {
    assert.throws(
      () => slotCount({ env: { KORE_TEST_SLOTS: bad }, cores: 4, load: 0 }),
      new RegExp(
        `KORE_TEST_SLOTS must be a positive whole number, got "${bad}"`,
      ),
    );
  }
});
