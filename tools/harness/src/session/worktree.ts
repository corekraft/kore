import { join } from "node:path";
import { mainRoot } from "../runtime/index.js";
import type { CliDeps } from "../runtime/index.js";
import { describeFailure } from "./equalize.js";

export interface Worktree {
  path: string;
  branch: string;
}

/** The command to run when a spawn fails after its worktree exists. */
export const removeHint = (worktree: Worktree): string =>
  `The worktree ${worktree.path} was left behind; remove it with \`git worktree remove ${worktree.path}\` and \`git branch -D ${worktree.branch}\`.`;

/**
 * Creates a worktree on a new branch under the main checkout's
 * .claude/worktrees/<name> and installs the CLI's dependencies in it, so a
 * parallel writer's builds and edits never collide with the caller's.
 */
async function create(
  deps: CliDeps,
  name: string,
  branch: string,
): Promise<Worktree | { error: string }> {
  const main = await mainRoot(deps);
  if (main === undefined) {
    return {
      error:
        "Cannot find the main checkout to create the worktree in. Run inside the repository or set KORE_ROOT to its root. No pane was split.",
    };
  }
  const worktree = { path: join(main, ".claude", "worktrees", name), branch };
  const add = await deps.runner.run(
    "git",
    ["worktree", "add", "-b", branch, worktree.path, "HEAD"],
    { cwd: main },
  );
  if (add.code !== 0) {
    return {
      error: `git worktree add failed: ${describeFailure(add)}. No pane was split.`,
    };
  }
  const install = await deps.runner.run("npm", ["ci"], {
    cwd: join(worktree.path, "tools", "kore"),
  });
  if (install.code !== 0) {
    return {
      error: `npm ci failed in the new worktree: ${describeFailure(install)}. No pane was split. ${removeHint(worktree)}`,
    };
  }
  return worktree;
}

export interface Placement {
  /** Set with --worktree. */
  worktree?: Worktree;
  /** The directory the pane starts in. */
  cwd: string;
  /** Appended to errors raised after the worktree exists. */
  left: string;
}

/** Applies --worktree and --branch: a fresh worktree, or the caller's own directory. */
export async function place(
  deps: CliDeps,
  options: Record<string, string | boolean | undefined>,
  name: string,
): Promise<Placement | { error: string }> {
  if (options.worktree !== true) {
    return { cwd: deps.cwd, left: "" };
  }
  const branch = typeof options.branch === "string" ? options.branch : name;
  const worktree = await create(deps, name, branch);
  if ("error" in worktree) {
    return worktree;
  }
  return { worktree, cwd: worktree.path, left: ` ${removeHint(worktree)}` };
}
