import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, localImageReuseFlag } from "../../src/config/index.js";

// Docs: AGENTS.md "It just works." (reuse is declared off until a live run proves it)

test("the local image reuse flag is named local-image-reuse", () => {
  assert.equal(localImageReuseFlag, "local-image-reuse");
});

test("the flag is declared off in every environment overlay", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = await loadRepository(name);
    assert.equal(
      repository.environment.features?.[localImageReuseFlag],
      false,
      `${name} must declare ${localImageReuseFlag} as false`,
    );
  }
});
