import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

// Mirrors tools/kore/src/runtime/host-locks.ts: kore writes its locks under
// <host root>/.kore/locks, shared by every worktree on the host.

/**
 * The host directory holding `.kore/locks`: `KORE_HOST_ROOT`, else `HOME`, else
 * the home directory. An empty value counts as unset, and a relative one is
 * refused, because a relative root would put the locks back per worktree.
 */
export function hostLocksDirectory(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const names = ["KORE_HOST_ROOT", "HOME"] as const;
  const name = names.find((n) => env[n] !== undefined && env[n] !== "");
  const root = name === undefined ? homedir() : env[name]!;
  if (!isAbsolute(root)) {
    throw new Error(
      `${name ?? "the home directory"} must be an absolute path, got "${root}"; set KORE_HOST_ROOT to an absolute directory or unset it`,
    );
  }
  return join(root, ".kore", "locks");
}
