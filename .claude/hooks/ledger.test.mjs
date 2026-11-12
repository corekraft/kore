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

// End to end: the real hook scripts, with the real harness bundle.
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

function project(t, { bundle = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kore-ledger-hook-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (bundle) {
    mkdirSync(join(dir, "skills", "bin"), { recursive: true });
    symlinkSync(
      join(repo, "skills", "bin", "harness.mjs"),
      join(dir, "skills", "bin", "harness.mjs"),
    );
  }
  return dir;
}

function runHook(script, args, payload, dir) {
  return spawnSync(process.execPath, [join(hooks, script), ...args], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: dir,
      KORE_ROOT: dir,
      HERDR_PANE_ID: "w9:p9",
    },
  });
}

async function ledgerEvents(dir) {
  const file = join(dir, ".kore", "state", "ledger.jsonl");
  for (let i = 0; i < 100 && !existsSync(file); i++)
    await new Promise((r) => setTimeout(r, 50));
  return existsSync(file)
    ? readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}

test("the pre-tool hook records a tool start with session, pane and tool, and no tool input", async (t) => {
  const dir = project(t);
  const result = runHook(
    "guard.mjs",
    [],
    { session_id: "s1", tool_name: "Grep", tool_input: { pattern: "hunter2" } },
    dir,
  );
  assert.equal(result.status, 0);
  const [event] = await ledgerEvents(dir);
  assert.deepEqual(
    [event.source, event.kind, event.session, event.pane, event.tool],
    ["claude", "tool.start", "s1", "w9:p9", "Grep"],
  );
  assert.equal(JSON.stringify(event).includes("hunter2"), false);
});

test("the post-tool hook records a tool end for a tool the edit checks ignore", async (t) => {
  const dir = project(t);
  const result = runHook(
    "feedback.mjs",
    ["post-edit"],
    { session_id: "s1", tool_name: "Bash", tool_input: { command: "ls" } },
    dir,
  );
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const [event] = await ledgerEvents(dir);
  assert.deepEqual(
    [event.kind, event.tool, event.outcome],
    ["tool.end", "Bash", "success"],
  );
});

test("a failed tool is recorded as a failure and never fails the hook", async (t) => {
  const dir = project(t);
  const result = runHook(
    "feedback.mjs",
    ["tool-failure"],
    { session_id: "s1", tool_name: "Bash" },
    dir,
  );
  assert.equal(result.status, 0);
  const [event] = await ledgerEvents(dir);
  assert.deepEqual([event.kind, event.outcome], ["tool.end", "failure"]);
});

test("the stop hook records a session stop once, not on its own re-entry", async (t) => {
  const dir = project(t);
  runHook("feedback.mjs", ["stop"], { session_id: "s1" }, dir);
  runHook(
    "feedback.mjs",
    ["stop"],
    { session_id: "s1", stop_hook_active: true },
    dir,
  );
  const events = await ledgerEvents(dir);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["session.stop"],
  );
});

test("the session start hook records a session start", async (t) => {
  const dir = project(t);
  runHook("context.mjs", [], { session_id: "s1", source: "resume" }, dir);
  const [event] = await ledgerEvents(dir);
  assert.deepEqual(
    [event.kind, event.session, event.pane],
    ["session.start", "s1", "w9:p9"],
  );
});

test("a missing bundle leaves the hook's verdict, stdout and exit code unchanged", (t) => {
  const bare = project(t, { bundle: false });
  const withBundle = project(t);
  const blocked = {
    session_id: "s1",
    tool_name: "Bash",
    tool_input: { command: "k3d cluster delete x" },
  };
  const a = runHook("guard.mjs", [], blocked, bare);
  const b = runHook("guard.mjs", [], blocked, withBundle);
  assert.equal(a.status, b.status);
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.stderr, b.stderr);
  assert.equal(existsSync(join(bare, ".kore")), false);
});

test("a failing edit check still returns its message and exit code 2 when recording works", async (t) => {
  const dir = project(t);
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
  const [event] = await ledgerEvents(dir);
  assert.equal(event.kind, "tool.end");
});

test("the read tool on a tracked source file is not linted now that the hook sees every tool", (t) => {
  const dir = project(t);
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
});
