import { homedir } from "node:os";
import { join } from "node:path";

// Mirrors tools/kore/src/runtime/host-locks.ts: kore writes its locks under
// <host root>/.kore/locks, shared by every worktree on the host.

/** The host directory holding `.kore/locks`: `KORE_HOST_ROOT`, else the home directory. */
export function hostLocksDirectory(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const root = [env.KORE_HOST_ROOT, env.HOME].find(
    (value) => value !== undefined && value !== "",
  );
  return join(root ?? homedir(), ".kore", "locks");
}
