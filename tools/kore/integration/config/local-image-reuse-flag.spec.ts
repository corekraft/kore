import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, localImageReuseFlag } from "../../src/config/index.js";

// Docs: AGENTS.md "It just works." (reuse is on in local after a recorded live run)

test("the local image reuse flag is named local-image-reuse", () => {
  assert.equal(localImageReuseFlag, "local-image-reuse");
});

test("the flag is on in local and off in managed-example", async () => {
  for (const [name, expected] of [
    ["local", true],
    ["managed-example", false],
  ] as const) {
    const repository = await loadRepository(name);
    assert.equal(
      repository.environment.features?.[localImageReuseFlag],
      expected,
      `${name} must declare ${localImageReuseFlag} as ${expected}`,
    );
  }
});
