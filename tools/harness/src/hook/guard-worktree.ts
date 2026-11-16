// A disposable worktree at a git ref, with the harness built into it, so the guard replay can ask
// that ref's own guard. The worktree lives under the repository's .claude/worktrees and is removed
// when the replay ends. Its build output is its own; nothing outside the worktree is written, except
// the dependency link, which points at the checkout's installed dependencies and is read only.

import { join } from "node:path";
import type { Runner, RunResult } from "../runtime/index.js";
import { GuardJudgeError } from "./guard-judge.js";

/** The worktree directory a replay name lives in, under the repository's .claude/worktrees. */
export function replayWorktreePath(root: string, name: string): string {
  return join(root, ".claude", "worktrees", name);
}

/** The environment a git or build call runs in: the given one, minus every GIT_* variable. */
export function scrubbed(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith("GIT_"),
    ),
  );
}

/** The call's result, or the error naming what failed and git's or the build's own message. */
function succeeded(result: RunResult, message: string): void {
  if (result.code !== 0) {
    throw new GuardJudgeError(`${message}: ${result.stderr.trim()}`);
  }
}

/**
 * Checks out `sha` in a new detached worktree named `name`, links the checkout's installed
 * dependencies in, and builds the harness there. A worktree that fails to build is removed before
 * the error is thrown, so a failed ref leaves nothing behind.
 */
export async function openReplayWorktree(
  runner: Runner,
  root: string,
  sha: string,
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  const path = replayWorktreePath(root, name);
  const clean = scrubbed(env);
  const harness = join(path, "tools", "harness");
  succeeded(
    await runner.run("git", ["worktree", "add", "--detach", path, sha], {
      cwd: root,
      env: clean,
    }),
    `could not check out ${sha} for the replay`,
  );
  try {
    succeeded(
      await runner.run("mkdir", ["-p", join(path, "skills", "bin")], {
        cwd: root,
        env: clean,
      }),
      "could not prepare the replay worktree",
    );
    succeeded(
      await runner.run(
        "ln",
        [
          "-s",
          join(root, "tools", "harness", "node_modules"),
          join(harness, "node_modules"),
        ],
        { cwd: root, env: clean },
      ),
      "could not link the harness's dependencies into the replay worktree (run npm ci in tools/harness)",
    );
    succeeded(
      await runner.run(process.execPath, ["build.mjs"], {
        cwd: harness,
        env: clean,
      }),
      `the guard at ${sha} did not build`,
    );
  } catch (error) {
    await closeReplayWorktree(runner, root, path, env).catch(() => undefined);
    throw error;
  }
  return path;
}

/** Removes a replay worktree from the repository, and prunes git's record of it. */
export async function closeReplayWorktree(
  runner: Runner,
  root: string,
  path: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const clean = scrubbed(env);
  const removed = await runner.run(
    "git",
    ["worktree", "remove", "--force", path],
    { cwd: root, env: clean },
  );
  if (removed.code !== 0) {
    throw new GuardJudgeError(
      `could not remove the replay worktree ${path}: ${removed.stderr.trim()}; remove it with git worktree remove --force`,
    );
  }
  await runner.run("git", ["worktree", "prune"], { cwd: root, env: clean });
}
