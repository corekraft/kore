import type { Runner } from "../runtime/index.js";
import { describeFailure } from "./equalize.js";
import type { Worktree } from "./worktree.js";

/** Whether the worktree and its branch were removed, and what was kept and why when they were not. */
export type Removal =
  { removed: true; message: string } | { removed: false; reason: string };

/** The reason the branch is not merged, or what stopped gh from saying; undefined when a merged PR has it as head. */
async function unmergedReason(
  runner: Runner,
  { branch }: Worktree,
  cwd: string,
): Promise<string | undefined> {
  const pulls = await runner.run(
    "gh",
    ["pr", "list", "--head", branch, "--state", "merged", "--json", "number"],
    { cwd },
  );
  if (pulls.code !== 0) {
    return `could not check whether ${branch} is merged: ${describeFailure(pulls)}.`;
  }
  let merged: unknown;
  try {
    merged = JSON.parse(pulls.stdout);
  } catch {
    return `could not read gh's answer about ${branch}.`;
  }
  if (!Array.isArray(merged)) {
    return `could not read gh's answer about ${branch}.`;
  }
  return merged.length === 0
    ? `branch ${branch} is unmerged: no merged PR has it as its head.`
    : undefined;
}

/** Why the worktree holds changes git would lose, or that its status cannot be read; undefined when clean. */
async function dirtyReason(
  runner: Runner,
  { path }: Worktree,
): Promise<string | undefined> {
  const status = await runner.run("git", ["status", "--porcelain"], {
    cwd: path,
  });
  if (status.code !== 0) {
    return `could not read worktree ${path}: ${describeFailure(status)}.`;
  }
  return status.stdout.trim() === ""
    ? undefined
    : `worktree ${path} has uncommitted or untracked changes.`;
}

/**
 * Removes a session's worktree and deletes its branch, only when a merged PR
 * has the branch as its head and the worktree is clean. The worktree goes
 * without force; the branch is force-deleted only after those checks, because
 * squash merges make the safe delete refuse every merged branch.
 */
export async function removeMergedWorktree(
  runner: Runner,
  worktree: Worktree,
  cwd: string,
): Promise<Removal> {
  const { path, branch } = worktree;
  const refusal =
    (await unmergedReason(runner, worktree, cwd)) ??
    (await dirtyReason(runner, worktree));
  if (refusal !== undefined) {
    return {
      removed: false,
      reason: `${refusal} Kept worktree ${path} and branch ${branch}.`,
    };
  }
  const removed = await runner.run("git", ["worktree", "remove", path], {
    cwd,
  });
  if (removed.code !== 0) {
    return {
      removed: false,
      reason: `git worktree remove ${path} failed: ${describeFailure(removed)}. Kept worktree and branch ${branch}.`,
    };
  }
  const deleted = await runner.run("git", ["branch", "-D", branch], { cwd });
  if (deleted.code !== 0) {
    return {
      removed: false,
      reason: `Removed worktree ${path}, but git branch -D ${branch} failed: ${describeFailure(deleted)}.`,
    };
  }
  return {
    removed: true,
    message: `Removed worktree ${path} and deleted branch ${branch}.`,
  };
}
