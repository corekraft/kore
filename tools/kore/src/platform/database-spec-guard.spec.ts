import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

// While the primary pod is replaced the pod list is briefly empty. An indexed
// jsonpath (`items[0]`) makes kubectl exit 1 on an empty list, which killed the
// persistence spec instead of letting it poll (found live on k3d).

test("the live persistence spec reads the primary pod without indexing an empty list", async () => {
  const source = await readFile(
    new URL("./platform.database.live.spec.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /items\[0\]/);
  assert.match(source, /\{range \.items\[\*\]\}/);
});
