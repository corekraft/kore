import { dirname, resolve } from "node:path";
import type { CliDeps } from "./command.js";

/**
 * The main checkout's root, shared by every worktree: the parent of git's
 * common dir, asked from this checkout's own root (never the working
 * directory). KORE_ROOT overrides. Undefined when neither can say.
 */
export async function mainRoot(
  deps: Pick<CliDeps, "root" | "env" | "cwd" | "runner">,
): Promise<string | undefined> {
  const checkout = await deps.root().catch(() => undefined);
  const override = deps.env["KORE_ROOT"];
  if (override !== undefined && override !== "") {
    return resolve(deps.cwd, override);
  }
  if (checkout === undefined) {
    return undefined;
  }
  const git = await deps.runner.run(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: checkout },
  );
  const common = git.stdout.trim();
  return git.code === 0 && common !== "" ? dirname(common) : undefined;
}
