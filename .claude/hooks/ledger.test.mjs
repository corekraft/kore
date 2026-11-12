import assert from "node:assert/strict";
import { test } from "./node-test-shim.mjs";

import { recordEvent } from "./ledger.mjs";

const root = "/repo";
const now = () => new Date("2026-01-02T03:04:05.678Z");

function fakeSpawn({ throws = false } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    if (throws) throw new Error("spawn failed");
    return { on: () => {}, unref: () => {} };
  };
  return { calls, spawn };
}

const call = {
  session_id: "s1",
  tool_name: "Bash",
  tool_input: { command: "echo secret" },
};

test("a tool start records session, pane and tool name through the harness bundle", () => {
  const { calls, spawn } = fakeSpawn();
  recordEvent("tool.start", call, {
    root,
    env: { HERDR_PANE_ID: "w3:p2" },
    spawn,
    now,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, [
    "/repo/skills/bin/harness.mjs",
    "ledger",
    "record",
    "--source",
    "claude",
    "--kind",
    "tool.start",
    "--occurred-at",
    "2026-01-02T03:04:05.678Z",
    "--session",
    "s1",
    "--pane",
    "w3:p2",
    "--tool",
    "Bash",
  ]);
  assert.equal(calls[0].options.cwd, root);
});

test("a tool end records success or failure as its outcome", () => {
  const { calls, spawn } = fakeSpawn();
  recordEvent("tool.end", call, {
    root,
    env: {},
    spawn,
    now,
    outcome: "failure",
  });
  const args = calls[0].args;
  assert.equal(args[args.indexOf("--outcome") + 1], "failure");
});

test("the pane is left out when Herdr does not set one", () => {
  const { calls, spawn } = fakeSpawn();
  recordEvent(
    "session.start",
    { session_id: "s1" },
    { root, env: {}, spawn, now },
  );
  assert.equal(calls[0].args.includes("--pane"), false);
  assert.equal(calls[0].args.includes("--tool"), false);
});

test("nothing from the prompt, tool input or tool output reaches the command line", () => {
  const { calls, spawn } = fakeSpawn();
  recordEvent(
    "tool.end",
    { ...call, prompt: "my private prompt", tool_response: "file contents" },
    { root, env: {}, spawn, now, outcome: "success" },
  );
  const line = calls[0].args.join(" ");
  for (const text of ["secret", "private prompt", "file contents", "echo"]) {
    assert.equal(line.includes(text), false);
  }
});

test("a failing spawn is swallowed", () => {
  const { spawn } = fakeSpawn({ throws: true });
  assert.doesNotThrow(() =>
    recordEvent("tool.start", call, { root, env: {}, spawn, now }),
  );
});

test("a payload without a session id records nothing", () => {
  const { calls, spawn } = fakeSpawn();
  recordEvent("tool.start", {}, { root, env: {}, spawn, now });
  assert.deepEqual(calls, []);
});

test("recording runs detached with ignored stdio so a hook never waits on it", () => {
  const { calls, spawn } = fakeSpawn();
  recordEvent("tool.start", call, { root, env: {}, spawn, now });
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, "ignore");
});

// End to end: the real hook scripts, with the real harness bundle. Recorders run
// detached, so each test says how many events it expects and its cleanup waits
// for them before removing the temporary project.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hooks = dirname(fileURLToPath(import.meta.url));
const repo = join(hooks, "..", "..");
const TIMEOUT = 15_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readEvents(dir) {
  const file = join(dir, ".kore", "state", "ledger.jsonl");
  return existsSync(file)
    ? readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

/** Poll until `count` events exist, then let any extra recorder finish, and return all of them. */
async function eventsOf(dir, count) {
  for (let i = 0; i < 200 && readEvents(dir).length < count; i++) {
    await sleep(50);
  }
  await sleep(600);
  return readEvents(dir);
}

function project(t, { bundle = true, expect = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kore-ledger-hook-"));
  t.after(async () => {
    await eventsOf(dir, expect);
    rmSync(dir, { recursive: true, force: true });
  });
  if (bundle) {
    mkdirSync(join(dir, "skills", "bin"), { recursive: true });
    symlinkSync(
      join(repo, "skills", "bin", "harness.mjs"),
      join(dir, "skills", "bin", "harness.mjs"),
    );
  }
  return dir;
}

function runHook(script, args, payload, dir, { ledger = true } = {}) {
  // The feedback, guard and context hooks are harness hooks; the others are still scripts.
  const bundle = join(repo, "skills", "bin", "harness.mjs");
  const argv =
    script === "feedback.mjs"
      ? [join(dir, "skills", "bin", "harness.mjs"), "hook", "feedback", ...args]
      : script === "guard.mjs"
        ? [bundle, "hook", "guard", ...args]
        : script === "context.mjs"
          ? [bundle, "hook", "context", ...args]
          : [join(hooks, script), ...args];
  return spawnSync(process.execPath, argv, {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: dir,
      KORE_ROOT: ledger ? dir : "",
      HERDR_PANE_ID: "w9:p9",
    },
  });
}

/** Proof of absence: a later recording that did land, with nothing else beside it. */
async function onlySentinel(dir) {
  runHook("guard.mjs", [], { session_id: "sentinel", tool_name: "Grep" }, dir);
  const events = await eventsOf(dir, 1);
  assert.deepEqual(
    events.map((e) => e.session),
    ["sentinel"],
  );
}

const kinds = (events) => events.map((e) => e.kind).sort();

test(
  "the pre-tool hook records a tool start with session, pane and tool, and no tool input",
  async (t) => {
    const dir = project(t, { expect: 1 });
    const result = runHook(
      "guard.mjs",
      [],
      {
        session_id: "s1",
        tool_name: "Grep",
        tool_input: { pattern: "hunter2" },
      },
      dir,
    );
    assert.equal(result.status, 0);
    const [event] = await eventsOf(dir, 1);
    assert.deepEqual(
      [event.source, event.kind, event.session, event.pane, event.tool],
      ["claude", "tool.start", "s1", "w9:p9", "Grep"],
    );
    assert.equal(JSON.stringify(event).includes("hunter2"), false);
  },
  TIMEOUT,
);

test(
  "a call the guard blocks records a tool start and a failed tool end",
  async (t) => {
    const dir = project(t, { expect: 2 });
    const result = runHook(
      "guard.mjs",
      [],
      {
        session_id: "s1",
        tool_name: "Bash",
        tool_input: { command: "k3d cluster delete x" },
      },
      dir,
    );
    assert.equal(result.status, 2);
    const events = await eventsOf(dir, 2);
    assert.deepEqual(kinds(events), ["tool.end", "tool.start"]);
    const end = events.find((e) => e.kind === "tool.end");
    assert.deepEqual([end.tool, end.outcome], ["Bash", "failure"]);
  },
  TIMEOUT,
);

test(
  "an allowed call records no tool end from the guard, since the post-tool hook owns it",
  async (t) => {
    const dir = project(t, { expect: 1 });
    runHook("guard.mjs", [], { session_id: "s1", tool_name: "Grep" }, dir);
    assert.deepEqual(kinds(await eventsOf(dir, 1)), ["tool.start"]);
  },
  TIMEOUT,
);

test(
  "the post-tool hook records a tool end for a tool the edit checks ignore",
  async (t) => {
    const dir = project(t, { expect: 1 });
    const result = runHook(
      "feedback.mjs",
      ["post-edit"],
      { session_id: "s1", tool_name: "Bash", tool_input: { command: "ls" } },
      dir,
    );
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const [event] = await eventsOf(dir, 1);
    assert.deepEqual(
      [event.kind, event.tool, event.outcome],
      ["tool.end", "Bash", "success"],
    );
  },
  TIMEOUT,
);

test(
  "a failed tool is recorded as a failure and never fails the hook",
  async (t) => {
    const dir = project(t, { expect: 1 });
    const result = runHook(
      "feedback.mjs",
      ["tool-failure"],
      { session_id: "s1", tool_name: "Bash" },
      dir,
    );
    assert.equal(result.status, 0);
    const [event] = await eventsOf(dir, 1);
    assert.deepEqual([event.kind, event.outcome], ["tool.end", "failure"]);
  },
  TIMEOUT,
);

test(
  "the stop hook records a session stop once, not on its own re-entry",
  async (t) => {
    const dir = project(t, { expect: 1 });
    runHook("feedback.mjs", ["stop"], { session_id: "s1" }, dir);
    runHook(
      "feedback.mjs",
      ["stop"],
      { session_id: "s1", stop_hook_active: true },
      dir,
    );
    assert.deepEqual(kinds(await eventsOf(dir, 1)), ["session.stop"]);
  },
  TIMEOUT,
);

for (const source of ["startup", "clear", "resume"]) {
  test(
    `a ${source} records a session start, with session and pane`,
    async (t) => {
      const dir = project(t, { expect: 1 });
      const result = runHook(
        "record.mjs",
        ["session-start"],
        { session_id: "s1", source },
        dir,
      );
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      const [event] = await eventsOf(dir, 1);
      assert.deepEqual(
        [event.kind, event.session, event.pane],
        ["session.start", "s1", "w9:p9"],
      );
    },
    TIMEOUT,
  );
}

test(
  "a compaction does not record a session start, since it continues the same session",
  async (t) => {
    const dir = project(t, { expect: 1 });
    const result = runHook(
      "record.mjs",
      ["session-start"],
      { session_id: "s1", source: "compact" },
      dir,
    );
    assert.equal(result.status, 0);
    await onlySentinel(dir);
  },
  TIMEOUT,
);

test(
  "the context hook records nothing, so its behaviour no longer depends on the ledger",
  async (t) => {
    const dir = project(t, { expect: 1 });
    runHook("context.mjs", [], { session_id: "s1", source: "startup" }, dir);
    await onlySentinel(dir);
  },
  TIMEOUT,
);

test(
  "a project with no ledger root leaves the guard's verdict, stdout and stderr unchanged",
  async (t) => {
    const bare = project(t, { bundle: false });
    const withBundle = project(t, { expect: 2 });
    const blocked = {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "k3d cluster delete x" },
    };
    const a = runHook("guard.mjs", [], blocked, bare, { ledger: false });
    const b = runHook("guard.mjs", [], blocked, withBundle);
    assert.equal(a.status, 2);
    assert.match(a.stderr, /\[guard:destructive\]/);
    assert.equal(a.status, b.status);
    assert.equal(a.stdout, b.stdout);
    assert.equal(a.stderr, b.stderr);
    await eventsOf(bare, 0);
    assert.equal(existsSync(join(bare, ".kore")), false);
  },
  TIMEOUT,
);

test(
  "a failing edit check still returns its message and exit code 2 when recording works",
  async (t) => {
    const dir = project(t, { expect: 1 });
    const result = runHook(
      "feedback.mjs",
      ["post-edit"],
      {
        session_id: "s1",
        tool_name: "Write",
        tool_input: { file_path: join(dir, "tools/kore/src/a.ts") },
      },
      dir,
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /oxlint/);
    const [event] = await eventsOf(dir, 1);
    assert.equal(event.kind, "tool.end");
    assert.equal(event.outcome, "success");
  },
  TIMEOUT,
);

test(
  "the read tool on a tracked source file is not linted now that the hook sees every tool",
  async (t) => {
    const dir = project(t, { expect: 1 });
    const result = runHook(
      "feedback.mjs",
      ["post-edit"],
      {
        session_id: "s1",
        tool_name: "Read",
        tool_input: { file_path: join(dir, "tools/kore/src/a.ts") },
      },
      dir,
    );
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    await eventsOf(dir, 1);
  },
  TIMEOUT,
);

test(
  "the pre-tool guard still allows tools it has no rule for, now that it sees every tool",
  async (t) => {
    const dir = project(t, { expect: 3 });
    for (const tool_name of ["Task", "WebFetch", "mcp__x__y"]) {
      const result = runHook(
        "guard.mjs",
        [],
        { session_id: "s1", tool_name, tool_input: { url: "x" } },
        dir,
      );
      assert.equal(result.status, 0, tool_name);
      assert.equal(result.stdout, "", tool_name);
    }
    await eventsOf(dir, 3);
  },
  TIMEOUT,
);
