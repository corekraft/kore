import { join } from "node:path";

// Docs: AGENTS.md "Mutations are serialized per environment."

/**
 * A state file of one environment, under `.kore/state/environments/<name>/`.
 * Worktrees and environments share one checkout's `.kore/state`, so files an
 * environment owns (its signing public key, local image lock and API token)
 * are keyed by environment instead of sitting beside another's.
 */
export function environmentStatePath(
  root: string,
  environment: string,
  file: string,
): string {
  return join(root, ".kore", "state", "environments", environment, file);
}
