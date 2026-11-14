import type { Runner } from "../runtime/index.js";
import { describeFailure } from "./equalize.js";
import type { Worktree } from "./worktree.js";

/** Whether the worktree and its branch were removed, and what was kept and why when they were not. */
export type Removal =
  { removed: true; message: string } | { removed: false; reason: string };

/** A refusal: what stopped the removal, and what the person does next. */
interface Stop {
  cause: string;
  fix: string;
}

/** The head commits of the merged PRs that have the branch as their head, or why gh could not say. */
type Merged = { heads: string[] } | Stop;

const isPull = (value: unknown): value is { headRefOid: string } =>
  typeof value === "object" &&
  value !== null &&
  "headRefOid" in value &&
  typeof value.headRefOid === "string";

async function mergedHeads(
  runner: Runner,
  branch: string,
  cwd: string,
): Promise<Merged> {
  const pulls = await runner.run(
    "gh",
    [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "merged",
      "--json",
      "number,headRefOid",
    ],
    { cwd },
  );
  const unreadable = {
    cause: `could not read gh's answer about ${branch}.`,
    fix: "Fix gh (for example with `gh auth status`).",
  };
  if (pulls.code !== 0) {
    return {
      cause: `could not check whether ${branch} is merged: ${describeFailure(pulls)}.`,
      fix: "Fix gh (for example with `gh auth status`).",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(pulls.stdout);
  } catch {
    return unreadable;
  }
  if (!Array.isArray(parsed) || !(parsed as unknown[]).every(isPull)) {
    return unreadable;
  }
  return {
    heads: (parsed as { headRefOid: string }[]).map((pr) => pr.headRefOid),
  };
}

/** The commit the worktree is at, or why git could not say. */
async function worktreeHead(
  runner: Runner,
  path: string,
): Promise<{ sha: string } | Stop> {
  const head = await runner.run("git", ["rev-parse", "HEAD"], { cwd: path });
  return head.code === 0
    ? { sha: head.stdout.trim() }
    : {
        cause: `could not read the HEAD of worktree ${path}: ${describeFailure(head)}.`,
        fix: `Fix the worktree at ${path}.`,
      };
}

/** Why the worktree holds changes git would lose, or that its status cannot be read; undefined when clean. */
async function dirtyStop(
  runner: Runner,
  path: string,
): Promise<Stop | undefined> {
  const status = await runner.run("git", ["status", "--porcelain"], {
    cwd: path,
  });
  if (status.code !== 0) {
    return {
      cause: `could not read worktree ${path}: ${describeFailure(status)}.`,
      fix: `Fix the worktree at ${path}.`,
    };
  }
  return status.stdout.trim() === ""
    ? undefined
    : {
        cause: `worktree ${path} has uncommitted or untracked changes.`,
        fix: "Commit, stash or delete them.",
      };
}

/**
 * Removes a session's worktree and deletes its branch, only when a merged PR
 * has the branch as its head at the worktree's HEAD and the worktree is clean.
 * The worktree goes without force; the branch is force-deleted only after
 * those checks, because squash merges make the safe delete refuse every merged
 * branch. A refusal names its cause and the fix, and ends by naming `rerun`,
 * the command that retries it.
 */
export async function removeMergedWorktree(
  runner: Runner,
  worktree: Worktree,
  cwd: string,
  rerun: string,
): Promise<Removal> {
  const { path, branch } = worktree;
  const then = `Then rerun \`${rerun}\`.`;
  const refuse = ({ cause, fix }: Stop): Removal => ({
    removed: false,
    reason: `${cause} Kept worktree ${path} and branch ${branch}. ${fix} ${then}`,
  });
  const merged = await mergedHeads(runner, branch, cwd);
  if (!("heads" in merged)) {
    return refuse(merged);
  }
  if (merged.heads.length === 0) {
    return refuse({
      cause: `branch ${branch} is unmerged: no merged PR has it as its head.`,
      fix: "Merge its PR.",
    });
  }
  const head = await worktreeHead(runner, path);
  if (!("sha" in head)) {
    return refuse(head);
  }
  if (!merged.heads.includes(head.sha)) {
    return refuse({
      cause: `worktree ${path} is at ${head.sha}, but the merged PR's head is ${merged.heads.join(", ")}: commits were added after the merge.`,
      fix: "Merge the newer commits.",
    });
  }
  const dirty = await dirtyStop(runner, path);
  if (dirty !== undefined) {
    return refuse(dirty);
  }
  const removed = await runner.run("git", ["worktree", "remove", path], {
    cwd,
  });
  if (removed.code !== 0) {
    return refuse({
      cause: `git worktree remove ${path} failed: ${describeFailure(removed)}.`,
      fix: "Clear what blocks it, such as a locked or ignored file.",
    });
  }
  const deleted = await runner.run("git", ["branch", "-D", branch], { cwd });
  if (deleted.code !== 0) {
    return {
      removed: false,
      reason: `Removed worktree ${path}, but git branch -D ${branch} failed: ${describeFailure(deleted)}. Finish by hand with \`git branch -D ${branch}\`.`,
    };
  }
  return {
    removed: true,
    message: `Removed worktree ${path} and deleted branch ${branch}.`,
  };
}
