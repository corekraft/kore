import type { CliDeps } from "../runtime/index.js";
import { RulesetError } from "./declared.js";

/**
 * Serializes ruleset mutations per repository (the environment): the lock is
 * a file created exclusively under .kore/state, so a second sync fails fast
 * and names the file instead of racing the first. A crashed sync leaves it
 * behind, so the refusal says how to clear it.
 */
export async function withLock<T>(
  deps: CliDeps,
  repo: string,
  action: () => Promise<T>,
): Promise<T> {
  const path = `${await deps.root()}/.kore/state/locks/ruleset-${repo.replace(/[^A-Za-z0-9._-]/g, "-")}.lock`;
  try {
    await deps.fs.createFile(
      path,
      JSON.stringify({ since: deps.clock.now().toISOString() }),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    throw new RulesetError(
      `Another ruleset sync holds the lock for ${repo}: ${path}. Wait for it to finish, then rerun. If no sync is running, delete that file, then rerun.`,
    );
  }
  try {
    return await action();
  } finally {
    await deps.fs.remove(path);
  }
}
