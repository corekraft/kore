import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

// A component whose feature flag is off is never installed, so a live spec that
// asks "is every component healthy" must skip it (found live: the agentgateway
// components are gated off in local and failed the resilience pre-check).

test("the live resilience spec checks only the components enabled in the environment", async () => {
  const source = await readFile(
    new URL("./resilience.integration.spec.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /enabledComponents\(repository\)/);
  assert.doesNotMatch(source, /catalog\.components\.map\(/);
});
