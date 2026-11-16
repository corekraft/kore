import type { CliDeps } from "../runtime/index.js";

/**
 * The worktree root the role guard judges paths against: the git top level of the launch
 * directory (CLAUDE_PROJECT_DIR), so a `cd` into a subfolder never moves it. The shell's
 * directory `shell` anchors only when the environment names none; the anchor itself stands
 * when git cannot say.
 */
export async function launchRoot(
  deps: Pick<CliDeps, "env" | "runner">,
  shell: string,
): Promise<string> {
  const anchor = deps.env["CLAUDE_PROJECT_DIR"] || shell;
  const top = await deps.runner.run("git", ["rev-parse", "--show-toplevel"], {
    cwd: anchor,
  });
  const path = top.stdout.trim();
  return top.code === 0 && path !== "" ? path : anchor;
}
