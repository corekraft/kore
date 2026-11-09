import type { Runner } from "../runtime/index.js";

const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
const CLI = "tools/kore";

/**
 * Checks out release tag `ref` into `dir` as a detached git worktree and builds
 * its own CLI from its lockfile, so the live upgrade test can install exactly
 * what that release shipped. It never touches the working tree or `.kore`.
 */
export async function checkoutRelease(
  runner: Runner,
  root: string,
  ref: string,
  dir: string,
): Promise<string> {
  if (!RELEASE_TAG.test(ref)) {
    throw new Error(
      `${ref} is not a release tag like v0.4.0; pass the tag of the supported previous release`,
    );
  }
  await runner.run("git", ["worktree", "add", "--detach", dir, ref], {
    capture: true,
    cwd: root,
  });
  try {
    for (const args of [
      ["--prefix", CLI, "ci"],
      ["--prefix", CLI, "run", "build"],
    ]) {
      await runner.run("npm", args, { capture: true, cwd: dir });
    }
  } catch (error) {
    await removeRelease(runner, root, dir);
    throw error;
  }
  return dir;
}

/** Runs the release's own built CLI against its own tree (`KORE_ROOT`). */
export async function releaseKore(
  runner: Runner,
  dir: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  return await runner.run("node", ["dist/src/cli/cli.js", ...args], {
    capture: false,
    cwd: `${dir}/${CLI}`,
    env: { ...env, KORE_ROOT: dir },
  });
}

/** Removes a worktree made by `checkoutRelease`; a worktree already gone is fine. */
export async function removeRelease(
  runner: Runner,
  root: string,
  dir: string,
): Promise<void> {
  try {
    await runner.run("git", ["worktree", "remove", "--force", dir], {
      capture: true,
      cwd: root,
    });
  } catch (error) {
    if (!/is not a working tree|does not exist/.test(String(error))) {
      throw error;
    }
  }
}
