import { hostname, uptime } from "node:os";
import { join } from "node:path";
import { hostLocksDirectory, type CliDeps } from "../runtime/index.js";

// A live run (`kore local up`, the live specs) holds the exclusive
// host lease: a lock file in the host lock directory that kore writes as
// {pid, host, token, acquiredAt}. The harness only reads it, and fails closed:
// a lease it cannot judge refuses a writer instead of counting as free.

export type HostLeaseStatus =
  | { state: "free" }
  | { state: "held"; pid: number; acquiredAt: string }
  | { state: "unverifiable"; reason: string; path: string };

/** Whether `acquiredAt` predates this host's boot, which a reused pid survives. */
function predatesBoot(acquiredAt: string): boolean {
  const acquired = Date.parse(acquiredAt);
  return acquired < Date.now() - uptime() * 1000;
}

async function hostLeaseStatus(
  deps: CliDeps,
  path: string,
): Promise<HostLeaseStatus> {
  if (!(await deps.fs.exists(path))) {
    return { state: "free" };
  }
  const unverifiable = (reason: string): HostLeaseStatus => ({
    state: "unverifiable",
    reason,
    path,
  });
  let owner: { pid?: unknown; host?: unknown; acquiredAt?: unknown };
  try {
    owner = JSON.parse(await deps.fs.readFile(path)) as typeof owner;
  } catch {
    return unverifiable("the lease file cannot be read or parsed");
  }
  if (!Number.isInteger(owner.pid) || typeof owner.acquiredAt !== "string") {
    return unverifiable("the lease file has no usable pid and time");
  }
  if (owner.host !== hostname()) {
    return unverifiable(
      `the lease was written on host ${String(owner.host)}, so its holder cannot be checked here`,
    );
  }
  if (predatesBoot(owner.acquiredAt)) {
    return { state: "free" };
  }
  const pid = owner.pid as number;
  const running = await deps.runner.run("ps", ["-p", String(pid)]);
  if (running.code === 0) {
    return { state: "held", pid, acquiredAt: owner.acquiredAt };
  }
  return running.code === 1
    ? { state: "free" }
    : unverifiable(`ps could not check pid ${pid} (exit ${running.code})`);
}

/**
 * Why a new writer must not start, or undefined when it may: a live run holds
 * the lease, or the lease cannot be judged (it is not treated as free).
 */
export async function hostLeaseRefusal(
  deps: CliDeps,
): Promise<string | undefined> {
  let path: string;
  try {
    path = join(hostLocksDirectory(deps.env), "host-lease.lock");
  } catch (error) {
    return `${(error as Error).message}. No session was started.`;
  }
  const status = await hostLeaseStatus(deps, path);
  if (status.state === "held") {
    return `A live run holds the host lease (pid ${status.pid}, since ${status.acquiredAt}), and a new writer would load the host beside it. Wait for the run to finish, then spawn again. No session was started.`;
  }
  return status.state === "unverifiable"
    ? `The host lease cannot be judged: ${status.reason}. Refusing the writer rather than risk loading a host with a live run. If no live run is going, remove ${status.path} and spawn again. No session was started.`
    : undefined;
}
