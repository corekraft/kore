import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, localImageReuseFlag } from "../../src/config/index.js";

// Docs: AGENTS.md "It just works." (reuse is on in local after a recorded live run)

test("the local image reuse flag is named local-image-reuse", () => {
  assert.equal(localImageReuseFlag, "local-image-reuse");
});

test("the flag is on in local, and managed-example does not declare it, since the manifest applies it to local only", async () => {
  const local = await loadRepository("local");
  assert.equal(local.environment.features?.[localImageReuseFlag], true);
  const managed = await loadRepository("managed-example");
  assert.equal(managed.environment.features?.[localImageReuseFlag], undefined);
});
