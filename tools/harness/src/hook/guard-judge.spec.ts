// The guard's verdict on one recorded call, as the built bundle's `hook guard` gives it: the exit
// code and output read back, the recorded paths moved into the replay worktree, and the process
// run through the injected runner.

import { describe, expect, it, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import {
  GuardJudgeError,
  judgeWith,
  judgedOf,
  payloadOf,
  relocate,
} from "./guard-judge.js";
import type { WindowCall } from "./guard-replay.js";

const result = (code: number, stdout = "", stderr = "") => ({
  code,
  stdout,
  stderr,
});

describe("judgedOf reads the guard's exit code and output", () => {
  it("allows a call the guard passes silently", () => {
    expect(judgedOf(result(0))).toEqual({ action: "allow" });
  });

  it("names the rule of a refusal from the guard's stderr", () => {
    expect(
      judgedOf(
        result(
          2,
          "",
          "[guard:unquoted-glob] zsh glob qualifier that runs code\n",
        ),
      ),
    ).toEqual({ action: "block", rule: "unquoted-glob" });
  });

  it("reads an audit-mode warning from the guard's JSON output as a warning", () => {
    const stdout = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: "[guard:bare-glob] a bare glob",
      },
    });
    expect(judgedOf(result(0, stdout))).toEqual({
      action: "warn",
      rule: "bare-glob",
    });
  });

  it("fails naming the exit code when the guard itself did not run", () => {
    expect(() => judgedOf(result(1, "", "TypeError: boom\n"))).toThrow(
      new GuardJudgeError("the guard exited 1: TypeError: boom"),
    );
  });
});

describe("relocate moves a recorded path into the replay worktree", () => {
  const from = ["/Users/jun/kore", "/Users/jun/kore/.claude/worktrees/other"];
  const to = "/Users/jun/kore/.claude/worktrees/replay-1";

  it("moves a path under a recorded checkout into the worktree", () => {
    expect(relocate("/Users/jun/kore/infra/a.md", from, to)).toBe(
      `${to}/infra/a.md`,
    );
  });

  it("moves a path under any other worktree of the repository, by its worktree name", () => {
    expect(
      relocate(
        "/Users/jun/elsewhere/.claude/worktrees/feature-x/tools/a.ts",
        [],
        to,
      ),
    ).toBe(`${to}/tools/a.ts`);
  });

  it("leaves a path outside the repository as it is", () => {
    expect(relocate("/tmp/scratch.txt", from, to)).toBe("/tmp/scratch.txt");
  });

  it("does not match a sibling whose name only starts with the root", () => {
    expect(relocate("/Users/jun/kore-old/a.ts", from, to)).toBe(
      "/Users/jun/kore-old/a.ts",
    );
  });
});

const paths = {
  from: ["/Users/jun/kore"],
  to: "/Users/jun/kore/.claude/worktrees/replay-1",
};

describe("payloadOf builds the PreToolUse payload the guard reads", () => {
  it("moves the call's directory and file path, and never names a session", () => {
    const recorded: WindowCall = {
      session: "s1",
      line: 3,
      at: "2026-11-15T10:00:00.000Z",
      cwd: "/Users/jun/kore/infra",
      tool: "Write",
      input: { file_path: "/Users/jun/kore/infra/a.md", content: "x" },
    };

    expect(payloadOf(recorded, paths)).toEqual({
      tool_name: "Write",
      tool_input: {
        file_path: `${paths.to}/infra/a.md`,
        content: "x",
      },
      cwd: `${paths.to}/infra`,
    });
  });

  it("leaves a Bash command as it was typed", () => {
    const recorded: WindowCall = {
      session: "s1",
      line: 1,
      at: "2026-11-15T10:00:00.000Z",
      cwd: "/Users/jun/kore",
      tool: "Bash",
      input: { command: "ls /Users/jun/kore/*.md" },
    };

    expect(payloadOf(recorded, paths)).toMatchObject({
      tool_input: { command: "ls /Users/jun/kore/*.md" },
    });
  });
});

describe("judgeWith runs the built guard in the worktree", () => {
  const recorded: WindowCall = {
    session: "s1",
    line: 1,
    at: "2026-11-15T10:00:00.000Z",
    cwd: "/Users/jun/kore",
    tool: "Bash",
    input: { command: "ls *.ts" },
  };
  const env = { PATH: "/usr/bin", HOME: "/home/x" };

  it("pipes the payload into the bundle's hook guard and reads the verdict back", async () => {
    const run = vi.fn(async () => result(2, "", "[guard:unquoted-glob] no\n"));
    const runner = { run } as unknown as Runner;

    const judged = await judgeWith(
      runner,
      `${paths.to}/skills/bin/harness.mjs`,
      { ...env, CLAUDE_PROJECT_DIR: paths.to },
      paths,
    )(recorded);

    expect(judged).toEqual({ action: "block", rule: "unquoted-glob" });
    expect(run).toHaveBeenCalledWith(
      process.execPath,
      [`${paths.to}/skills/bin/harness.mjs`, "hook", "guard"],
      {
        cwd: paths.to,
        env: { ...env, CLAUDE_PROJECT_DIR: paths.to },
        input: JSON.stringify(payloadOf(recorded, paths)),
      },
    );
  });
});
