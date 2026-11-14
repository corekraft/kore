// Commit-hook test runs share a host-wide semaphore, so many worktrees
// committing at once take turns instead of multiplying vitest workers: up to
// the slot count run together and the rest wait with a message. A dead holder
// never blocks.
// Docs: docs/guides/contributor.md (Commit hooks)

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  utimesSync,
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
  return { dir, lock: join(dir, "test-slot-0.lock") };
}

const envFor = (dir, extra = {}) => ({
  ...process.env,
  KORE_TEST_LOCK_DIR: dir,
  KORE_TEST_LOCK_POLL_MS: "50",
  KORE_TEST_SLOTS: "1",
  ...extra,
});

function run(dir, command, extra) {
  return spawnSync(process.execPath, [script, ...command], {
    encoding: "utf8",
    cwd: dir,
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
  assert.doesNotMatch(result.stderr, /waiting for a test slot/);
});

test("a live holder is waited for, naming its pid, then the next run proceeds", async (t) => {
  const { dir, lock } = setup(t);
  const holder = spawn(
    process.execPath,
    [script, ...node("setTimeout(() => {}, 700)")],
    { cwd: dir, env: envFor(dir) },
  );
  t.after(() => holder.kill());
  while (!existsSync(lock)) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const owner = JSON.parse(readFileSync(lock, "utf8"));
  const result = await new Promise((resolve) => {
    const waiter = spawn(process.execPath, [script, ...node("")], {
      cwd: dir,
      env: envFor(dir, { KORE_TEST_LOCK_WAIT_MS: "10000" }),
    });
    let stderr = "";
    waiter.stderr.on("data", (d) => (stderr += d));
    waiter.on("close", (status) => resolve({ status, stderr }));
  });
  assert.equal(result.status, 0);
  assert.match(
    result.stderr,
    new RegExp(`waiting for a test slot: 1 in use by pid ${owner.pid}`),
  );
});

test("a holder that never finishes fails the waiter at the timeout with the fix", (t) => {
  const { dir, lock } = setup(t);
  writeFileSync(lock, JSON.stringify({ pid: process.pid, cwd: "/busy" }));
  const result = run(dir, node(""), { KORE_TEST_LOCK_WAIT_MS: "300" });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    new RegExp(`test slots still held by pid ${process.pid}`),
  );
  assert.ok(result.stderr.includes(`remove ${lock}`));
  assert.equal(existsSync(lock), true, "a live holder's lock is left alone");
});

function hold(dir, ms, extra) {
  return spawn(
    process.execPath,
    [script, ...node(`setTimeout(() => {}, ${ms})`)],
    {
      cwd: dir,
      env: envFor(dir, extra),
    },
  );
}

async function slotsTaken(dir, count) {
  while (
    [0, 1, 2].filter((n) => existsSync(join(dir, `test-slot-${n}.lock`)))
      .length < count
  ) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("runs up to the slot count start at once; the next waits and says so", async (t) => {
  const { dir } = setup(t);
  const two = { KORE_TEST_SLOTS: "2" };
  const first = hold(dir, 1500, two);
  const second = hold(dir, 1500, two);
  t.after(() => {
    first.kill();
    second.kill();
  });
  await slotsTaken(dir, 2);
  const started = Date.now();
  const third = spawnSync(process.execPath, [script, ...node("")], {
    encoding: "utf8",
    cwd: dir,
    env: envFor(dir, { ...two, KORE_TEST_LOCK_WAIT_MS: "10000" }),
  });
  assert.equal(third.status, 0);
  assert.ok(Date.now() - started > 500, "the third run waited for a slot");
  assert.match(third.stderr, /waiting for a test slot: 2 in use by pid/);
});

test("a free slot below the size is used at once, with no waiting message", async (t) => {
  const { dir } = setup(t);
  const two = { KORE_TEST_SLOTS: "2" };
  const first = hold(dir, 1500, two);
  t.after(() => first.kill());
  await slotsTaken(dir, 1);
  const second = spawnSync(process.execPath, [script, ...node("")], {
    encoding: "utf8",
    cwd: dir,
    env: envFor(dir, two),
  });
  assert.equal(second.status, 0);
  assert.doesNotMatch(second.stderr, /waiting for a test slot/);
});

test("a bad KORE_TEST_SLOTS fails the run with the fix instead of running unbounded", (t) => {
  const { dir } = setup(t);
  const result = run(dir, node(""), { KORE_TEST_SLOTS: "many" });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /KORE_TEST_SLOTS must be a positive whole number/,
  );
});

// Audit first: a hook test run beside a live run is reported, not yet held back.
// Enforcing it (waiting for the lease) needs the owner's OK. Docs: #340.

function hostWith(t, lease) {
  const host = mkdtempSync(join(tmpdir(), "kore-host-"));
  t.after(() => rmSync(host, { recursive: true, force: true }));
  if (lease !== undefined) {
    mkdirSync(join(host, ".kore", "locks"), { recursive: true });
    writeFileSync(
      join(host, ".kore", "locks", "host-lease.lock"),
      JSON.stringify({ pid: lease, host: "h", token: "t", acquiredAt: "now" }),
    );
  }
  return host;
}

test("a test run beside a live run is audited, still runs, and keeps its exit code", (t) => {
  const { dir } = setup(t);
  const host = hostWith(t, process.pid);
  const result = run(dir, node("process.exit(3)"), { KORE_HOST_ROOT: host });
  assert.equal(result.status, 3, "audit mode never blocks the run");
  assert.match(
    result.stderr,
    new RegExp(`audit: host lease held by pid ${process.pid}`),
  );
  const log = readFileSync(join(dir, "host-lease-audit.jsonl"), "utf8");
  assert.equal(JSON.parse(log.trim()).holder, process.pid);
});

test("a free host lease, or one whose holder is gone, is not audited", (t) => {
  const { dir } = setup(t);
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  for (const lease of [undefined, dead]) {
    const result = run(dir, node(""), { KORE_HOST_ROOT: hostWith(t, lease) });
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stderr, /host lease/);
  }
  assert.equal(existsSync(join(dir, "host-lease-audit.jsonl")), false);
});

test("an empty KORE_HOST_ROOT is unset, so the lease is still found under HOME", (t) => {
  const { dir } = setup(t);
  const host = hostWith(t, process.pid);
  const result = run(dir, node("process.exit(0)"), {
    KORE_HOST_ROOT: "",
    HOME: host,
  });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /audit: host lease held by pid/);
});

test("a relative KORE_HOST_ROOT is reported and ignored, never a reason to block", (t) => {
  const { dir } = setup(t);
  const result = run(dir, node("process.exit(4)"), {
    KORE_HOST_ROOT: "relative/dir",
  });
  assert.equal(result.status, 4);
  assert.match(result.stderr, /audit: .*KORE_HOST_ROOT.*absolute/);
});

test("audit can never block: an unwritable audit log does not abort the run", (t) => {
  const { dir } = setup(t);
  mkdirSync(join(dir, "host-lease-audit.jsonl"));
  const host = hostWith(t, process.pid);
  const result = run(dir, node("process.exit(5)"), { KORE_HOST_ROOT: host });
  assert.equal(result.status, 5);
  assert.match(result.stderr, /audit: host lease held by pid/);
  assert.match(result.stderr, /audit log/);
});

// A slot is claimed with complete content, and one that cannot be read is
// someone's claim in progress, never a dead holder's leftover.

test("an unreadable fresh slot is a claim in progress: waited on, never deleted", (t) => {
  const { dir, lock } = setup(t);
  writeFileSync(lock, "");
  const result = run(dir, node(""), { KORE_TEST_LOCK_WAIT_MS: "300" });
  assert.equal(result.status, 1);
  assert.equal(existsSync(lock), true, "the half-written slot is left alone");
});

test("an unreadable slot that stays unreadable for over a few seconds is broken", (t) => {
  const { dir, lock } = setup(t);
  writeFileSync(lock, "{");
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  const result = run(dir, node(""), { KORE_TEST_LOCK_WAIT_MS: "5000" });
  assert.equal(result.status, 0);
});

test("a slot whose pid is alive but predates the host's boot is broken (pid reuse)", (t) => {
  const { dir, lock } = setup(t);
  writeFileSync(
    lock,
    JSON.stringify({
      pid: process.pid,
      cwd: "/before-reboot",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }),
  );
  const result = run(dir, node(""), { KORE_TEST_LOCK_WAIT_MS: "5000" });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stderr, /waiting for a test slot/);
});

test("breaking a dead slot leaves no stray file, and a live slot is never moved", (t) => {
  const { dir, lock } = setup(t);
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(lock, JSON.stringify({ pid: dead, cwd: "/gone" }));
  assert.equal(run(dir, node("")).status, 0);
  assert.deepEqual(
    readdirSync(dir).filter((name) => /broken|\.tmp$/.test(name)),
    [],
  );
  const live = JSON.stringify({ pid: process.pid, cwd: "/busy" });
  writeFileSync(lock, live);
  run(dir, node(""), { KORE_TEST_LOCK_WAIT_MS: "200" });
  assert.equal(readFileSync(lock, "utf8"), live);
});

// A pass is recorded only by a real green run of the step itself, for the staged
// tree and the exact command, and only when the working tree has no unstaged
// change: tests that ran on other content must not vouch for the staged tree.

// Under the commit hook GIT_INDEX_FILE and friends point at the real repository.
const withoutGit = (env) =>
  Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith("GIT_")),
  );
const cleanEnv = withoutGit(process.env);

function repo(t) {
  const { dir } = setup(t);
  const work = mkdtempSync(join(tmpdir(), "kore-test-pass-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const git = (...args) =>
    spawnSync("git", args, { cwd: work, env: cleanEnv, encoding: "utf8" });
  git("init", "-q");
  writeFileSync(join(work, "a.txt"), "one\n");
  git("add", "a.txt");
  const counter = join(dir, "ran.log");
  const step = (exit = 0, tag = "") =>
    node(
      `require("fs").appendFileSync(${JSON.stringify(counter)}, "x${tag}"); process.exit(${exit})`,
    );
  const go = (command) =>
    spawnSync(process.execPath, [script, ...command], {
      cwd: work,
      env: { ...withoutGit(envFor(dir)), KORE_TEST_SLOTS: "1" },
      encoding: "utf8",
    });
  const ran = () => (existsSync(counter) ? readFileSync(counter, "utf8") : "");
  return { git, step, go, ran, work, dir };
}

test("a green run records the staged tree, and the same step on it is skipped with a message", (t) => {
  const { step, go, ran } = repo(t);
  assert.equal(go(step()).status, 0);
  const again = go(step());
  assert.equal(again.status, 0);
  assert.equal(ran(), "x", "the second run ran nothing");
  assert.match(again.stderr, /tests already passed at tree [0-9a-f]{40}/);
});

test("a changed staged tree runs the step again", (t) => {
  const { git, step, go, ran, work } = repo(t);
  go(step());
  writeFileSync(join(work, "a.txt"), "two\n");
  git("add", "a.txt");
  go(step());
  assert.equal(ran(), "xx");
});

test("a different command on the same tree is a different step and runs", (t) => {
  const { step, go, ran } = repo(t);
  go(step(0, "1"));
  go(step(0, "2"));
  assert.equal(ran(), "x1x2");
});

test("a failing run records nothing and keeps its exit code", (t) => {
  const { step, go, ran } = repo(t);
  assert.equal(go(step(3)).status, 3);
  assert.equal(go(step(3)).status, 3);
  assert.equal(ran(), "xx");
});

test("a pass over unstaged changes is not recorded: the staged tree was not what ran", (t) => {
  const { step, go, ran, work } = repo(t);
  writeFileSync(join(work, "a.txt"), "unstaged fix\n");
  assert.equal(go(step()).status, 0);
  assert.equal(go(step()).status, 0);
  assert.equal(ran(), "xx", "both runs ran; nothing was recorded");
});

test("a pass beside an untracked file is not recorded: the file may have made the tests pass", (t) => {
  const { step, go, ran, work } = repo(t);
  writeFileSync(join(work, "scratch.txt"), "not staged\n");
  assert.equal(go(step()).status, 0);
  assert.equal(go(step()).status, 0);
  assert.equal(ran(), "xx", "both runs ran; nothing was recorded");
});

test("an ignored file does not stop a pass from being recorded", (t) => {
  const { git, step, go, ran, work } = repo(t);
  writeFileSync(join(work, ".gitignore"), "*.log\n");
  git("add", ".gitignore");
  writeFileSync(join(work, "noise.log"), "ignored\n");
  go(step());
  go(step());
  assert.equal(ran(), "x");
});

test("a tree that cannot be read still runs the step, never skips or fails it", (t) => {
  const { dir } = setup(t);
  const elsewhere = mkdtempSync(join(tmpdir(), "kore-no-repo-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [script, ...node("process.exit(4)")],
    {
      cwd: elsewhere,
      env: { ...withoutGit(envFor(dir)), GIT_DIR: join(elsewhere, "none") },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 4);
  assert.doesNotMatch(result.stderr, /already passed/);
});
