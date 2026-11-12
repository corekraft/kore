// Delta: what changed between a session's turns, as UserPromptSubmit context.
// Plan: infra/plans/6-agent-primitives.md#step-3-what-changed-between-turns

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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import {
  CommandError,
  nodeFileSystem,
  ProcessRunner,
  systemClock,
} from "../runtime/index.js";
import { planText } from "./delta-support.js";

// Under a git hook GIT_DIR and friends are set and would aim the fixture's git
// calls at the real repository.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
) as Record<string, string>;

// ProcessRunner children inherit process.env, so drop GIT_* for each test.
const savedGit: Record<string, string> = {};
beforeEach(() => {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("GIT_")) {
      savedGit[name] = process.env[name] ?? "";
      delete process.env[name];
    }
  }
});

const temps: string[] = [];
afterEach(() => {
  Object.assign(process.env, savedGit);
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repoFixture(): { root: string; git: (...args: string[]) => void } {
  const root = mkdtempSync(join(tmpdir(), "kore-delta-"));
  temps.push(root);
  const git = (...args: string[]) => {
    spawnSync("git", args, { cwd: root, encoding: "utf8", env: cleanEnv });
  };
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
  return { root, git };
}

async function hook(root: string, input: unknown) {
  const h = testHarness({ env: cleanEnv });
  h.deps.fs = nodeFileSystem;
  h.deps.runner = new ProcessRunner();
  h.deps.clock = systemClock;
  h.deps.root = () => Promise.resolve(root);
  h.deps.cwd = root;
  h.deps.stdin = () =>
    Promise.resolve(typeof input === "string" ? input : JSON.stringify(input));
  const code = await run(["hook", "delta"], h.deps);
  return { code, out: h.out(), err: h.err() };
}

describe("hook delta", () => {
  it("exits 0 without output for malformed or non-object input", async () => {
    const { root } = repoFixture();
    for (const input of [
      "not json",
      "null",
      "42",
      "[]",
      "{}",
      '{"session_id":7}',
      '{"session_id":"../x"}',
    ]) {
      expect(await hook(root, input), input).toEqual({
        code: 0,
        out: "",
        err: "",
      });
    }
  });

  it("injects a change between two prompts as additionalContext", async () => {
    const { root, git } = repoFixture();
    const event = { hook_event_name: "UserPromptSubmit", session_id: "sess-1" };
    expect(await hook(root, event)).toEqual({ code: 0, out: "", err: "" });

    writeFileSync(
      join(root, "infra/plans/6-plan.md"),
      planText("- [x] Build it."),
    );
    mkdirSync(join(root, ".kore/locks"), { recursive: true });
    writeFileSync(join(root, ".kore/locks/local.lock"), "");
    git("commit", "-qam", "feat: build it");

    const second = await hook(root, event);
    expect(second.code).toBe(0);
    expect(second.out).toBe(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext:
            "Changed since your last turn: main advanced 1 commit: feat: build it | 6-plan.md ticked: Build it. | lock taken: local.lock",
        },
      }),
    );
    expect(second.err).toBe("");

    expect((await hook(root, event)).out).toBe("");
  });

  it("fails open with one stderr line when the repository root cannot be resolved", async () => {
    const h = testHarness();
    h.deps.root = () => Promise.reject(new CommandError("no repo root here"));
    h.deps.stdin = () => Promise.resolve('{"session_id":"sess-1"}');
    expect(await run(["hook", "delta"], h.deps)).toBe(0);
    expect(h.out()).toBe("");
    expect(h.err()).toBe("[hook:delta] failed open: no repo root here\n");
  });
});

describe("hook delta housekeeping", () => {
  it("deletes other sessions' snapshots older than 14 days and keeps the current one", async () => {
    const { root } = repoFixture();
    const dir = join(root, ".git", "kore-delta");
    mkdirSync(dir, { recursive: true });
    const old = join(dir, "old-session.json");
    const recent = join(dir, "recent-session.json");
    const own = join(dir, "sess-1.json");
    for (const file of [old, recent, own]) {
      writeFileSync(file, "{}");
    }
    const DAY = 24 * 60 * 60 * 1000;
    const ago = (days: number) => new Date(Date.now() - days * DAY);
    utimesSync(old, ago(15), ago(15));
    utimesSync(recent, ago(13), ago(13));
    utimesSync(own, ago(30), ago(30));

    const result = await hook(root, {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-1",
    });
    expect(result.code).toBe(0);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(own)).toBe(true);
  });
});
