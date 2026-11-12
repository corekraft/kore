// Commit-hook test runs serialize host-wide, so many worktrees committing at
// once queue instead of multiplying vitest workers. A dead holder never blocks.
// Docs: docs/guides/contributor.md (Commit hooks)

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "./node-test-shim.mjs";

const script = fileURLToPath(
  new URL("../../tools/kore/.husky/test-lock.mjs", import.meta.url),
);

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "kore-test-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, lock: join(dir, "test.lock") };
}

const envFor = (dir, extra = {}) => ({
  ...process.env,
  KORE_TEST_LOCK_DIR: dir,
  KORE_TEST_LOCK_POLL_MS: "50",
  ...extra,
});

function run(dir, command, extra) {
  return spawnSync(process.execPath, [script, ...command], {
    encoding: "utf8",
    env: envFor(dir, extra),
  });
}

const node = (code) => [process.execPath, "-e", code];

test("the command runs under the lock, keeps its exit code and frees the lock", (t) => {
  const { dir, lock } = setup(t);
  const held = run(
    dir,
    node(
      `process.exit(require("fs").existsSync(${JSON.stringify(lock)}) ? 0 : 9)`,
    ),
  );
  assert.equal(held.status, 0);
  assert.equal(existsSync(lock), false);
  assert.equal(run(dir, node("process.exit(3)")).status, 3);
  assert.equal(existsSync(lock), false);
});

test("a stale lock whose process is gone is broken, never waited on", (t) => {
  const { dir, lock } = setup(t);
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(lock, JSON.stringify({ pid: dead, cwd: "/elsewhere" }));
  const result = run(dir, node(""), { KORE_TEST_LOCK_WAIT_MS: "5000" });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stderr, /waiting for another worktree/);
});

test("a live holder is waited for, naming its pid, then the next run proceeds", async (t) => {
  const { dir, lock } = setup(t);
  const holder = spawn(
    process.execPath,
    [script, ...node("setTimeout(() => {}, 700)")],
    { env: envFor(dir) },
  );
  t.after(() => holder.kill());
  while (!existsSync(lock)) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const owner = JSON.parse(readFileSync(lock, "utf8"));
  const result = await new Promise((resolve) => {
    const waiter = spawn(process.execPath, [script, ...node("")], {
      env: envFor(dir, { KORE_TEST_LOCK_WAIT_MS: "10000" }),
    });
    let stderr = "";
    waiter.stderr.on("data", (d) => (stderr += d));
    waiter.on("close", (status) => resolve({ status, stderr }));
  });
  assert.equal(result.status, 0);
  assert.match(
    result.stderr,
    new RegExp(`waiting for another worktree's tests \\(pid ${owner.pid}\\)`),
  );
});

test("a holder that never finishes fails the waiter at the timeout with the fix", (t) => {
  const { dir, lock } = setup(t);
  writeFileSync(lock, JSON.stringify({ pid: process.pid, cwd: "/busy" }));
  const result = run(dir, node(""), { KORE_TEST_LOCK_WAIT_MS: "300" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`still held by pid ${process.pid}`));
  assert.ok(result.stderr.includes(`remove ${lock}`));
  assert.equal(existsSync(lock), true, "a live holder's lock is left alone");
});
