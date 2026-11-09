import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";

// Docs: docs/decisions/0056-platform-image-inventory.md

test("an unknown image inventory mode is rejected before any cluster is touched", async () => {
  const base = await loadRepository("local");

  await assert.rejects(
    validateRepository({
      ...base,
      environment: { ...base.environment, imageInventory: "warn" as never },
    }),
    /environment\.imageInventory must be audit or enforce/,
  );
});

test("local audits and managed-example enforces the image inventory", async () => {
  assert.equal(
    (await loadRepository("local")).environment.imageInventory,
    "audit",
  );
  assert.equal(
    (await loadRepository("managed-example")).environment.imageInventory,
    "enforce",
  );
});
