import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "./node-test-shim.mjs";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bundle = join(root, "skills", "bin", "harness.mjs");
const script = join(root, "tools", "harness", "check-bundle.sh");
const run = () => spawnSync("bash", [script], { cwd: root, encoding: "utf8" });

test("a current bundle passes the staleness check and stays unchanged", () => {
  const before = readFileSync(bundle, "utf8");
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(bundle, "utf8"), before);
});

test("a stale bundle fails the check, names the rebuild task, and is left rebuilt", () => {
  const current = readFileSync(bundle, "utf8");
  try {
    writeFileSync(bundle, `${current}// stale\n`);
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /mise run harness-build/);
    assert.match(result.stderr, /skills\/bin\/harness\.mjs/);
    assert.equal(readFileSync(bundle, "utf8"), current);
  } finally {
    writeFileSync(bundle, current);
  }
});

test("CI runs the staleness check after the harness tests, and mise exposes it", () => {
  const workflow = readFileSync(
    join(root, ".github", "workflows", "check.yml"),
    "utf8",
  );
  assert.match(workflow, /run: mise run harness-check\n/);
  const mise = readFileSync(join(root, ".mise.toml"), "utf8");
  assert.match(mise, /\[tasks\.harness-check\]/);
  assert.match(mise, /harness-lint/);
});
