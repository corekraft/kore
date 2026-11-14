import { harnessFreshness, JudgeError } from "../judge/index.js";
import type { CommandContext } from "../runtime/index.js";
import { bundleCommit } from "./build-commit-support.js";

/**
 * Fails fast when this harness bundle is behind origin/main for tools/harness; warns, without
 * failing, when GitHub cannot say. Read-only: it only calls `gh api` through the runner.
 */
export async function requireFreshBundle(
  { deps }: CommandContext,
  root: string,
  repo: string,
): Promise<void> {
  const api = async (args: readonly string[]): Promise<string> => {
    const done = await deps.runner.run("gh", args, { cwd: root });
    if (done.code !== 0) {
      throw new Error(done.stderr.trim());
    }
    return done.stdout;
  };
  const result = await harnessFreshness(api, repo, bundleCommit());
  if (result.state === "behind") {
    throw new JudgeError(result.message);
  }
  if (result.state === "unknown") {
    deps.stderr(`warning: ${result.message}\n`);
  }
}
