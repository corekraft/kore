import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "./node-test-shim.mjs";
import { fileURLToPath } from "node:url";

import { describeChanges, snapshot, update } from "./delta.mjs";

const hook = fileURLToPath(new URL("./delta.mjs", import.meta.url));

const planText = (...items) =>
  `---\nstatus: active\nsummary: A plan.\nlast-verified: 2026-11-07\n---\n\n## Step 1: Work\n\n${items.join("\n")}\n`;

const entry = (op, kind, extra = {}) => ({
  ts: "2026-11-07T10:00:00.000Z",
  op,
  kind,
  ...extra,
});

/** Fixture-backed deps; override fields per test. */
function fakeDeps(overrides = {}) {
  const store = new Map();
  return {
    store,
    head: () => "aaa1111",
    branch: () => "feat/x",
    main: () => "bbb2222",
    commitsBetween: () => [],
    readPlans: () => ({ "6-plan.md": planText("- [ ] Build it.") }),
    listLocks: () => [],
    readJournals: () => ({}),
    readSnapshot: (id) => store.get(id) ?? null,
    writeSnapshot: (id, snap) => store.set(id, snap),
    now: () => 0,
    listSnapshots: () => [],
    removeSnapshot: () => {},
    ...overrides,
  };
}

test("the first prompt of a session writes a snapshot and prints nothing", () => {
  const deps = fakeDeps();
  assert.equal(update("s1", deps), "");
  assert.equal(deps.store.get("s1").main, "bbb2222");
});

test("a prompt with nothing changed prints nothing", () => {
  const deps = fakeDeps();
  update("s1", deps);
  assert.equal(update("s1", deps), "");
});

test("sessions keep separate snapshots", () => {
  const deps = fakeDeps();
  update("s1", deps);
  const moved = {
    ...deps,
    main: () => "ccc3333",
    commitsBetween: () => ["feat: x"],
  };
  assert.equal(update("s2", moved), "", "s2 has no earlier snapshot");
  assert.match(update("s1", moved), /main/);
});

test("new commits on main are reported with their subjects", () => {
  const deps = fakeDeps();
  update("s1", deps);
  const moved = {
    ...deps,
    main: () => "ccc3333",
    commitsBetween: (from, to) => {
      assert.deepEqual([from, to], ["bbb2222", "ccc3333"]);
      return ["feat: add journal", "fix: typo"];
    },
  };
  const out = update("s1", moved);
  assert.match(out, /main advanced 2 commits/);
  assert.match(out, /feat: add journal/);
});

test("a branch switch is reported", () => {
  const deps = fakeDeps();
  update("s1", deps);
  assert.match(
    update("s1", { ...deps, branch: () => "feat/y" }),
    /branch changed from feat\/x to feat\/y/,
  );
});

test("plan items ticked or added are reported, and unticked items are not", () => {
  const deps = fakeDeps({
    readPlans: () => ({
      "6-plan.md": planText("- [ ] Build it.", "- [ ] Ship it."),
    }),
  });
  update("s1", deps);
  const out = update("s1", {
    ...deps,
    readPlans: () => ({
      "6-plan.md": planText(
        "- [x] Build it.",
        "- [ ] Ship it.",
        "- [ ] Document it.",
      ),
    }),
  });
  assert.match(out, /6-plan\.md/);
  assert.match(out, /ticked: Build it\./);
  assert.match(out, /added: Document it\./);
  assert.doesNotMatch(out, /Ship it/);
});

test("locks taken and released are reported", () => {
  const deps = fakeDeps({ listLocks: () => ["local.lock"] });
  update("s1", deps);
  const out = update("s1", { ...deps, listLocks: () => ["staging.lock"] });
  assert.match(out, /lock taken: staging\.lock/);
  assert.match(out, /lock released: local\.lock/);
});

test("journal operations started, finished, and failed are reported", () => {
  const started = { local: [entry("a", "start", { command: "local up" })] };
  const deps = fakeDeps({ readJournals: () => started });
  assert.equal(
    update("s1", deps),
    "",
    "journal state at first prompt is the baseline",
  );

  const finished = {
    local: [...started.local, entry("a", "end", { outcome: "ok" })],
  };
  assert.match(
    update("s1", { ...deps, readJournals: () => finished }),
    /local: `local up` finished ok/,
  );

  const next = {
    local: [...finished.local, entry("b", "start", { command: "local down" })],
  };
  assert.match(
    update("s1", { ...deps, readJournals: () => next }),
    /local: `local down` started/,
  );

  const failed = {
    local: [
      ...next.local,
      entry("b", "end", { outcome: "failed", error: "boom" }),
    ],
  };
  assert.match(
    update("s1", { ...deps, readJournals: () => failed }),
    /local: `local down` failed: boom/,
  );
});

test("a new journal in a known session is reported as a started operation", () => {
  const deps = fakeDeps();
  update("s1", deps);
  assert.match(
    update("s1", {
      ...deps,
      readJournals: () => ({
        local: [entry("a", "start", { command: "local up" })],
      }),
    }),
    /local: `local up` started/,
  );
});

test("output is capped at 600 characters", () => {
  const deps = fakeDeps();
  update("s1", deps);
  const many = Array.from(
    { length: 80 },
    (_, i) => `- [ ] Item number ${i} with some text.`,
  );
  const out = update("s1", {
    ...deps,
    readPlans: () => ({ "6-plan.md": planText(...many) }),
    listLocks: () => Array.from({ length: 40 }, (_, i) => `env${i}.lock`),
  });
  assert.ok(out.length > 0);
  assert.ok(out.length <= 600, `length ${out.length}`);
});

test("snapshot records head, branch, main, plan items, locks, and the last journal operation", () => {
  const snap = snapshot(
    fakeDeps({
      listLocks: () => ["local.lock"],
      readJournals: () => ({
        local: [
          entry("a", "start", { command: "local up" }),
          entry("a", "end", { outcome: "ok" }),
        ],
      }),
    }),
  );
  assert.equal(snap.head, "aaa1111");
  assert.equal(snap.branch, "feat/x");
  assert.deepEqual(snap.locks, ["local.lock"]);
  assert.deepEqual(snap.journal.local, {
    op: "a",
    command: "local up",
    outcome: "ok",
  });
  assert.deepEqual(snap.plans["6-plan.md"], { "Build it.": false });
});

test("describeChanges returns an empty string for identical snapshots", () => {
  const snap = snapshot(fakeDeps());
  assert.equal(
    describeChanges(snap, snap, () => []),
    "",
  );
});

test("a git or filesystem failure prints nothing instead of throwing", () => {
  const deps = fakeDeps();
  update("s1", deps);
  const broken = {
    ...deps,
    main: () => {
      throw new Error("git exploded");
    },
  };
  assert.equal(update("s1", broken), "");
});

// Under a git hook (pre-commit runs these tests) GIT_DIR and friends are set and
// would point the fixture's git calls at the real repository.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

const DAY = 24 * 60 * 60 * 1000;

test("writing a snapshot prunes other sessions' snapshots older than 14 days, never its own", () => {
  const removed = [];
  const now = 100 * DAY;
  const deps = fakeDeps({
    now: () => now,
    listSnapshots: () => [
      { id: "old", mtimeMs: now - 15 * DAY },
      { id: "recent", mtimeMs: now - 13 * DAY },
      { id: "s1", mtimeMs: now - 30 * DAY },
    ],
    removeSnapshot: (id) => removed.push(id),
  });
  update("s1", deps);
  assert.deepEqual(removed, ["old"]);
});

test("a failure while pruning does not lose the delta", () => {
  const deps = fakeDeps();
  update("s1", deps);
  const out = update("s1", {
    ...deps,
    branch: () => "feat/y",
    listSnapshots: () => {
      throw new Error("readdir failed");
    },
  });
  assert.match(out, /branch changed/);
  const noisy = update("s1", {
    ...deps,
    branch: () => "feat/z",
    listSnapshots: () => [{ id: "old", mtimeMs: -99 * DAY }],
    removeSnapshot: () => {
      throw new Error("unlink failed");
    },
    now: () => 0,
  });
  assert.match(noisy, /feat\/z/);
});

function runCli(root, input, env = {}) {
  return spawnSync(process.execPath, [hook], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...cleanEnv, CLAUDE_PROJECT_DIR: root, ...env },
  });
}

test("cli: malformed or non-object input exits 0 without output", () => {
  for (const input of [
    "not json",
    "null",
    "42",
    "[]",
    "{}",
    '{"session_id":7}',
  ]) {
    const result = runCli(tmpdir(), input);
    assert.equal(result.status, 0, input);
    assert.equal(result.stdout, "", input);
    assert.equal(result.stderr, "", input);
  }
});

test("cli: a repository change between two prompts is injected as additionalContext", (t) => {
  const root = mkdtempSync(join(tmpdir(), "kore-delta-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8", env: cleanEnv });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(root, "infra/plans"), { recursive: true });
  writeFileSync(
    join(root, "infra/plans/6-plan.md"),
    planText("- [ ] Build it."),
  );
  git("add", ".");
  git("commit", "-q", "-m", "chore: start");

  const event = { hook_event_name: "UserPromptSubmit", session_id: "sess-1" };
  const first = runCli(root, event);
  assert.equal(first.status, 0);
  assert.equal(first.stdout, "");

  writeFileSync(
    join(root, "infra/plans/6-plan.md"),
    planText("- [x] Build it."),
  );
  mkdirSync(join(root, ".kore/locks"), { recursive: true });
  writeFileSync(join(root, ".kore/locks/local.lock"), "");
  git("commit", "-qam", "feat: build it");

  const second = runCli(root, event);
  assert.equal(second.status, 0);
  const output = JSON.parse(second.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, "UserPromptSubmit");
  assert.match(output.additionalContext, /main advanced 1 commit/);
  assert.match(output.additionalContext, /ticked: Build it\./);
  assert.match(output.additionalContext, /lock taken: local\.lock/);

  assert.equal(
    runCli(root, event).stdout,
    "",
    "nothing new on the third prompt",
  );
});

test("cli: snapshots of other sessions older than 14 days are deleted, the current one stays", (t) => {
  const root = mkdtempSync(join(tmpdir(), "kore-delta-prune-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8", env: cleanEnv });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(root, "a.txt"), "a");
  git("add", ".");
  git("commit", "-q", "-m", "chore: start");

  const dir = join(root, ".git", "kore-delta");
  mkdirSync(dir, { recursive: true });
  const old = join(dir, "old-session.json");
  const recent = join(dir, "recent-session.json");
  const own = join(dir, "sess-1.json");
  for (const file of [old, recent, own]) writeFileSync(file, "{}");
  const ago = (days) => new Date(Date.now() - days * DAY);
  utimesSync(old, ago(15), ago(15));
  utimesSync(recent, ago(13), ago(13));
  utimesSync(own, ago(30), ago(30));

  const result = runCli(root, {
    hook_event_name: "UserPromptSubmit",
    session_id: "sess-1",
  });
  assert.equal(result.status, 0);
  assert.equal(existsSync(old), false, "old snapshot is pruned");
  assert.equal(existsSync(recent), true, "recent snapshot stays");
  assert.equal(existsSync(own), true, "the current session's snapshot stays");
});
