import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "./index.js";

test("the offline test task also runs the reference application's own suite", async () => {
  const { root } = await loadRepository("local");
  const mise = await readFile(join(root, ".mise.toml"), "utf8");
  const task = mise.match(/\[tasks\.test\]\n(?:.*\n)*?run = "([^"]*)"/)?.[1];
  assert.ok(task, "the test task has a run command");
  assert.match(task, /npm --prefix tools\/kore test/);
  assert.match(task, /npm --prefix apps\/reference test/);
});
