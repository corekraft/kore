import { homedir } from "node:os";

// Docs: AGENTS.md "Mutations are serialized per environment."

/**
 * The directory whose `.kore/locks` holds the host's locks. Locks are shared by
 * every worktree on the host, so they live under the home directory, beside
 * `~/.kore/k3d/<cluster>`, never inside one checkout. `KORE_HOST_ROOT`
 * relocates it for tests.
 */
export function hostRoot(): string {
  return process.env.KORE_HOST_ROOT ?? homedir();
}

/**
 * The name an environment's lock is keyed by. Worktrees that share a cluster
 * share its lock, so a k3d environment is keyed by its cluster name; an
 * environment without a cluster is keyed by its own name.
 */
export function lockScope(environment: {
  name: string;
  k3d?: { clusterName: string } | undefined;
}): string {
  return environment.k3d?.clusterName ?? environment.name;
}
