import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import {
  comparePinnedTools,
  parseMiseTools,
} from "../../src/config/tool-pins.js";

test("every tool .mise.toml and the tool catalog both pin is at the same version, and no tool is in only one file without an allow-list entry", async () => {
  const { root, versions } = await loadRepository("local");
  const mise = parseMiseTools(await readFile(join(root, ".mise.toml"), "utf8"));
  assert.equal(mise.node, versions.tools.node, "the parse reads .mise.toml");
  assert.deepEqual(comparePinnedTools(mise, versions.tools), []);
});
