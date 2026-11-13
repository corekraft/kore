import { join } from "node:path";
import type { CliDeps } from "../runtime/index.js";

// A live run (`kore local up`, the live integration specs) holds the exclusive
// host lease: a lock file in the host lock directory that kore writes as
// {pid, host, token, acquiredAt}. The harness only reads it.

export interface HostLeaseHolder {
  pid: number;
  acquiredAt: string | undefined;
}

/** The lease file's path: under `KORE_HOST_ROOT`, else the home directory. */
function leasePath(deps: CliDeps): string | undefined {
  const root = deps.env.KORE_HOST_ROOT ?? deps.env.HOME;
  return root === undefined || root === ""
    ? undefined
    : join(root, ".kore", "locks", "host-lease.lock");
}

/** The live run holding the lease, or undefined when it is free or its holder is gone. */
export async function hostLeaseHolder(
  deps: CliDeps,
): Promise<HostLeaseHolder | undefined> {
  const path = leasePath(deps);
  if (path === undefined || !(await deps.fs.exists(path))) {
    return undefined;
  }
  let owner: { pid?: unknown; acquiredAt?: unknown };
  try {
    owner = JSON.parse(await deps.fs.readFile(path)) as typeof owner;
  } catch {
    return undefined;
  }
  if (!Number.isInteger(owner.pid)) {
    return undefined;
  }
  const pid = owner.pid as number;
  // A holder that died leaves its file; kore recovers it, a reader just ignores it.
  const running = await deps.runner.run("ps", ["-p", String(pid)]);
  return running.code === 0
    ? {
        pid,
        acquiredAt:
          typeof owner.acquiredAt === "string" ? owner.acquiredAt : undefined,
      }
    : undefined;
}
