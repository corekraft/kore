import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import { pinnedBrowserImage } from "../../src/testing/index.js";

// One owner for the browser image: the version catalog's browser-test entry. The code's
// pinnedBrowserImage must equal it, so a bump in one place cannot leave the other behind.
test("the sign-in check runs the browser-test image the version catalog pins by digest", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.versions.images["browser-test"], pinnedBrowserImage);
  assert.match(pinnedBrowserImage, /@sha256:[0-9a-f]{64}$/);
});
