// A disposable worktree at a ref, with the harness built into it, for the guard replay. The runner
// is mocked: each git, mkdir, ln and build call is checked for its arguments, its directory and its
// environment, which must carry no GIT_* variable.

import { describe, expect, it, vi } from "vitest";
import type { Runner, RunResult } from "../runtime/index.js";
import { GuardJudgeError } from "./guard-judge.js";
import {
  closeReplayWorktree,
  openReplayWorktree,
  replayWorktreePath,
} from "./guard-worktree.js";

const ROOT = "/repo";
const SHA = "a1b2c3d";
const PATH = `${ROOT}/.claude/worktrees/replay-1`;
const ENV = { PATH: "/usr/bin", HOME: "/home/x" };
const ok: RunResult = { stdout: "", stderr: "", code: 0 };
const failed = (stderr: string): RunResult => ({
  stdout: "",
  stderr,
  code: 128,
});

interface Call {
  command: string;
  args: readonly string[];
  cwd: string | undefined;
  env: Record<string, string> | undefined;
}

/** A runner that records each call and answers with the given results, in order, else ok. */
function recording(...results: RunResult[]) {
  const calls: Call[] = [];
  const run = vi.fn(
    async (
      command: string,
      args: readonly string[],
      options?: { cwd?: string; env?: Record<string, string> },
    ) => {
      calls.push({
        command,
        args,
        cwd: options?.cwd,
        env: options?.env,
      });
      return results.shift() ?? ok;
    },
  );
  return { calls, runner: { run } as unknown as Runner };
}

describe("replayWorktreePath", () => {
  it("places the worktree under the repository's .claude/worktrees", () => {
    expect(replayWorktreePath(ROOT, "replay-1")).toBe(PATH);
  });
});

describe("openReplayWorktree checks out the ref and builds the harness in it", () => {
  it("adds a detached worktree at the ref, links the dependencies and builds the bundle", async () => {
    const { runner, calls } = recording();

    const opened = await openReplayWorktree(runner, ROOT, SHA, "replay-1", ENV);

    expect(opened).toBe(PATH);
    expect(calls).toEqual([
      {
        command: "git",
        args: ["worktree", "add", "--detach", PATH, SHA],
        cwd: ROOT,
        env: ENV,
      },
      {
        command: "mkdir",
        args: ["-p", `${PATH}/skills/bin`],
        cwd: ROOT,
        env: ENV,
      },
      {
        command: "ln",
        args: [
          "-s",
          `${ROOT}/tools/harness/node_modules`,
          `${PATH}/tools/harness/node_modules`,
        ],
        cwd: ROOT,
        env: ENV,
      },
      {
        command: process.execPath,
        args: ["build.mjs"],
        cwd: `${PATH}/tools/harness`,
        env: ENV,
      },
    ]);
  });

  it("strips every GIT_* variable from the environment each call runs in", async () => {
    const { runner, calls } = recording();

    await openReplayWorktree(runner, ROOT, SHA, "replay-1", {
      ...ENV,
      GIT_DIR: "/repo/.git",
      GIT_INDEX_FILE: "/repo/.git/index",
    });

    for (const call of calls) {
      expect(
        Object.keys(call.env ?? {}).filter((k) => k.startsWith("GIT_")),
      ).toEqual([]);
    }
  });
});

describe("openReplayWorktree reports the step that failed", () => {
  it("fails naming the ref when the ref cannot be checked out", async () => {
    const { runner } = recording(failed("fatal: invalid reference: nope\n"));

    await expect(
      openReplayWorktree(runner, ROOT, SHA, "replay-1", ENV),
    ).rejects.toThrow(
      new GuardJudgeError(
        `could not check out ${SHA} for the replay: fatal: invalid reference: nope`,
      ),
    );
  });

  it("fails naming the ref and the build's own message when the harness does not build", async () => {
    const { runner } = recording(
      ok,
      ok,
      ok,
      failed('Could not resolve "esbuild"\n'),
    );

    await expect(
      openReplayWorktree(runner, ROOT, SHA, "replay-1", ENV),
    ).rejects.toThrow(
      `the guard at ${SHA} did not build: Could not resolve "esbuild"`,
    );
  });
});

describe("openReplayWorktree leaves nothing behind when the ref fails", () => {
  it("removes the worktree it added when the harness does not build", async () => {
    const { runner, calls } = recording(ok, ok, ok, failed("esbuild failed\n"));

    await expect(
      openReplayWorktree(runner, ROOT, SHA, "replay-1", ENV),
    ).rejects.toThrow(`the guard at ${SHA} did not build`);
    expect(calls.slice(4)).toEqual([
      {
        command: "git",
        args: ["worktree", "remove", "--force", PATH],
        cwd: ROOT,
        env: ENV,
      },
      { command: "git", args: ["worktree", "prune"], cwd: ROOT, env: ENV },
    ]);
  });
});

describe("closeReplayWorktree removes the worktree it opened", () => {
  it("force-removes the worktree from the repository and prunes it", async () => {
    const { runner, calls } = recording();

    await closeReplayWorktree(runner, ROOT, PATH, ENV);

    expect(calls).toEqual([
      {
        command: "git",
        args: ["worktree", "remove", "--force", PATH],
        cwd: ROOT,
        env: ENV,
      },
      {
        command: "git",
        args: ["worktree", "prune"],
        cwd: ROOT,
        env: ENV,
      },
    ]);
  });

  it("names the worktree to remove by hand when git cannot remove it", async () => {
    const { runner } = recording(failed("fatal: is locked\n"));

    await expect(closeReplayWorktree(runner, ROOT, PATH, ENV)).rejects.toThrow(
      `could not remove the replay worktree ${PATH}: fatal: is locked; remove it with git worktree remove --force`,
    );
  });
});
