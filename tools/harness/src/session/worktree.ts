import { join } from "node:path";
import { mainRoot } from "../runtime/index.js";
import type { CliDeps } from "../runtime/index.js";
import { describeFailure } from "./describe-failure.js";
import { SessionRegistry } from "./registry.js";

export interface Worktree {
  path: string;
  branch: string;
}

const removeCommands = (worktree: Worktree): string =>
  `\`git worktree remove ${worktree.path}\` and \`git branch -D ${worktree.branch}\``;

/** What to run when a spawn fails after its worktree exists. */
export const removeHint = (worktree: Worktree): string =>
  `The worktree ${worktree.path} was left behind; remove it with ${removeCommands(worktree)}.`;

/** What to run once a closed session's worktree is no longer needed. */
export const closeHint = (worktree: Worktree): string =>
  `Remove its worktree once its branch is merged: ${removeCommands(worktree)}.`;

/** How the tick records a session whose terminal ended with its parent (plan 16, Grilled Decisions 10). */
const LOST = "lost with its parent";

/** Whether the session's record says it was lost with its parent in this very worktree, on this branch. */
async function lostHere(
  deps: CliDeps,
  name: string,
  worktree: Worktree,
): Promise<boolean> {
  const record = await (await SessionRegistry.open(deps)).read(name);
  return (
    record?.result?.outcome === "blocked" &&
    record.result.summary?.startsWith(LOST) === true &&
    record.worktree?.path === worktree.path &&
    record.worktree.branch === worktree.branch
  );
}

/**
 * Decides what to do with a worktree path that already exists: only the one a session was lost in, on the
 * branch it was recorded on, is reused as it is. Any other path is left alone, never recreated or reset.
 * Returns why it cannot be reused, or undefined when it can.
 */
async function reuse(
  deps: CliDeps,
  name: string,
  worktree: Worktree,
): Promise<string | undefined> {
  if (!(await lostHere(deps, name, worktree))) {
    return `${worktree.path} already exists and is not the worktree of a session recorded lost with its parent, so it was not reused, recreated or reset. Pick another session name, or remove it yourself once nothing there is needed.`;
  }
  const head = await deps.runner.run(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: worktree.path },
  );
  if (head.code !== 0) {
    return `Cannot read the branch of the existing worktree ${worktree.path}: ${describeFailure(head)}. It was not reused.`;
  }
  const on = head.stdout.trim();
  return on === worktree.branch
    ? undefined
    : `The existing worktree ${worktree.path} is on ${on}, not ${worktree.branch}, so it was not reused or reset. Check out ${worktree.branch} there, or pass --branch ${on}.`;
}

/**
 * Creates a worktree on a new branch under the main checkout's
 * .claude/worktrees/<name> (or reuses the one a session of that name was lost
 * with its parent in, on the same branch) and installs the CLI's dependencies in it, so a
 * parallel writer's builds and edits never collide with the caller's. The
 * path lives under the main checkout, but the branch starts from the HEAD of
 * the caller's own directory.
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
        "Cannot find the main checkout to create the worktree in. Run inside the repository or set KORE_ROOT to its root.",
    };
  }
  const worktree = { path: join(main, ".claude", "worktrees", name), branch };
  const existing = await deps.fs.exists(worktree.path);
  const refusal = existing ? await reuse(deps, name, worktree) : undefined;
  if (refusal !== undefined) {
    return { error: refusal };
  }
  const add = existing
    ? undefined
    : await deps.runner.run(
        "git",
        ["worktree", "add", "-b", branch, worktree.path, "HEAD"],
        { cwd: deps.cwd },
      );
  if (add !== undefined && add.code !== 0) {
    return {
      error: `git worktree add failed: ${describeFailure(add)}. A previous spawn may have left the worktree or branch: run ${removeCommands(worktree)}, or pass --branch <other>.`,
    };
  }
  const install = await deps.runner.run("npm", ["ci"], {
    cwd: join(worktree.path, "tools", "kore"),
  });
  if (install.code !== 0) {
    return {
      error: `npm ci failed in the new worktree: ${describeFailure(install)}. ${removeHint(worktree)}`,
    };
  }
  // The pane's hooks need the harness bundle from its first tool call, and the
  // fix hint is itself a tool call the guard would block (ADR 0092).
  const harness = join(worktree.path, "tools", "harness");
  const harnessInstall = await deps.runner.run("npm", ["ci"], { cwd: harness });
  if (harnessInstall.code !== 0) {
    return {
      error: `npm ci failed for the harness in the new worktree: ${describeFailure(harnessInstall)}. ${removeHint(worktree)}`,
    };
  }
  const build = await deps.runner.run("npm", ["run", "build", "--silent"], {
    cwd: harness,
  });
  if (build.code !== 0) {
    return {
      error: `Building the harness bundle failed in the new worktree: ${describeFailure(build)}. The pane's guard hook would block every tool call. ${removeHint(worktree)}`,
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
