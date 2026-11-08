import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm, unlink } from "node:fs/promises";
import { hostname, uptime } from "node:os";
import { join } from "node:path";

/** Who holds a lock. Written atomically with the lock itself. */
interface LockOwner {
  pid: number;
  host: string;
  token: string;
  acquiredAt: string;
}

export interface LockOptions {
  /** Whether a process exists on this host. Defaults to `kill(pid, 0)`. */
  isProcessAlive?: (pid: number) => boolean;
  /** Host boot time in epoch milliseconds. Defaults to `now - uptime`. */
  bootTime?: () => number;
  /** Receives a message when a stale lock was recovered. Defaults to stderr. */
  onRecover?: (message: string) => void;
}

// Clock and uptime readings differ by a little; only a clear gap proves a reboot.
const BOOT_TOLERANCE_MS = 60_000;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

async function readOwner(lock: string): Promise<LockOwner | undefined> {
  let text: string;
  try {
    text = await readFile(lock, "utf8");
  } catch (error) {
    // A legacy lock is a directory; a vanished lock is handled by the caller.
    if (["EISDIR", "ENOENT"].includes(errorCode(error) ?? "")) return undefined;
    throw error;
  }
  try {
    const value = JSON.parse(text) as Partial<LockOwner>;
    if (
      Number.isInteger(value.pid) &&
      typeof value.host === "string" &&
      typeof value.token === "string" &&
      typeof value.acquiredAt === "string"
    )
      return value as LockOwner;
  } catch {
    // Malformed content is treated like a missing owner.
  }
  return undefined;
}

function refusal(
  environment: string,
  lock: string,
  detail: string,
  fix: string,
): Error {
  return new Error(
    `another mutation is already running for environment ${environment}: ${detail} (lock ${lock}). ${fix}`,
  );
}

/**
 * Runs `operation` while holding the environment's lock.
 *
 * The lock is a file created with `link`, so it appears atomically with its
 * owner record. A lock is recovered only when its owner is provably dead on this
 * host: the pid is gone, or the lock predates the host's boot (which survives
 * pid reuse). Anything unprovable (live owner, other host, legacy directory
 * lock, malformed record) is refused, because breaking a live lock is worse
 * than asking for manual removal.
 */
export async function withEnvironmentLock<T>(
  root: string,
  environment: string,
  operation: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const isAlive = options.isProcessAlive ?? processAlive;
  const bootTime = options.bootTime ?? (() => Date.now() - uptime() * 1000);
  const onRecover =
    options.onRecover ??
    ((message: string) => process.stderr.write(`${message}\n`));
  const base = join(root, ".kore", "locks");
  const lock = join(base, `${environment}.lock`);
  const recovery = `${lock}.recovery`;
  await mkdir(base, { recursive: true });

  const owner: LockOwner = {
    pid: process.pid,
    host: hostname(),
    token: randomUUID(),
    acquiredAt: new Date().toISOString(),
  };
  const staging = join(base, `${environment}.${owner.token}.tmp`);
  const acquire = async (): Promise<boolean> => {
    await rm(staging, { force: true });
    const handle = await open(staging, "wx");
    try {
      await handle.writeFile(JSON.stringify(owner));
    } finally {
      await handle.close();
    }
    try {
      await link(staging, lock);
      return true;
    } catch (error) {
      if (errorCode(error) === "EEXIST") return false;
      throw error;
    } finally {
      await rm(staging, { force: true });
    }
  };

  /** Returns a description of the dead owner, or the reason it cannot be recovered. */
  const judge = async (): Promise<
    | { dead: true; owner: LockOwner }
    | { dead: false; reason: string; fix: string }
  > => {
    const current = await readOwner(lock);
    const manual = `If no kore process is running, remove it with: rm -rf ${lock}`;
    if (current === undefined)
      return {
        dead: false,
        reason: "its owner is unknown (legacy or malformed lock)",
        fix: manual,
      };
    if (current.host !== hostname())
      return {
        dead: false,
        reason: `held by pid ${current.pid} on host ${current.host}, which cannot be checked from here`,
        fix: manual,
      };
    const predatesBoot =
      Date.parse(current.acquiredAt) < bootTime() - BOOT_TOLERANCE_MS;
    if (isAlive(current.pid) && !predatesBoot)
      return {
        dead: false,
        reason: `held by running pid ${current.pid}`,
        fix: "Wait for it to finish, or stop that process.",
      };
    return { dead: true, owner: current };
  };

  /** Breaks the stale lock; only one concurrent caller can hold the recovery lock. */
  const recover = async (): Promise<LockOwner | undefined> => {
    let handle;
    try {
      handle = await open(recovery, "wx");
    } catch (error) {
      if (errorCode(error) === "EEXIST") return undefined;
      throw error;
    }
    try {
      // Re-judge under the recovery lock: the lock may have changed hands.
      const verdict = await judge();
      if (!verdict.dead) return undefined;
      await unlink(lock);
      return verdict.owner;
    } finally {
      await handle.close();
      await rm(recovery, { force: true });
    }
  };

  let recovered: LockOwner | undefined;
  if (!(await acquire())) {
    const verdict = await judge();
    if (!verdict.dead)
      throw refusal(environment, lock, verdict.reason, verdict.fix);
    recovered = await recover();
    if (recovered === undefined || !(await acquire()))
      throw refusal(
        environment,
        lock,
        "another process is recovering or has just taken it",
        `Retry shortly; if it persists, check ${recovery} and ${lock}.`,
      );
    onRecover(
      `recovered stale lock ${lock} left by pid ${recovered.pid} (acquired ${recovered.acquiredAt}); the previous mutation was interrupted, so check \`kore journal\` before trusting the environment state`,
    );
  }

  try {
    return await operation();
  } finally {
    // Only remove the lock if it is still ours.
    if ((await readOwner(lock))?.token === owner.token)
      await rm(lock, { force: true });
  }
}
