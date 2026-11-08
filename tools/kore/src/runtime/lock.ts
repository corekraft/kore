import { randomUUID } from "node:crypto";
import { link, mkdir, open, rm } from "node:fs/promises";
import { hostname, uptime } from "node:os";
import { join } from "node:path";
import {
  errorCode,
  processAlive,
  readOwner,
  type LockOwner,
} from "./lock-owner.js";
import {
  judge,
  recover,
  refusal,
  type LockPaths,
  type LockProbes,
} from "./lock-recovery.js";

export interface LockOptions {
  /** Whether a process exists on this host. Defaults to `kill(pid, 0)`. */
  isProcessAlive?: (pid: number) => boolean;
  /** Host boot time in epoch milliseconds. Defaults to `now - uptime`. */
  bootTime?: () => number;
  /** Receives a message when a stale lock was recovered. Defaults to stderr. */
  onRecover?: (message: string) => void;
}

/** Creates the lock with `link` so it appears atomically with its owner record. */
async function acquire(
  lock: string,
  staging: string,
  owner: LockOwner,
): Promise<boolean> {
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
    if (errorCode(error) === "EEXIST") {
      return false;
    }
    throw error;
  } finally {
    await rm(staging, { force: true });
  }
}

/** Replaces a provably dead owner's lock, or throws an actionable refusal. */
async function recoverStale(
  environment: string,
  paths: LockPaths,
  probes: LockProbes,
  take: () => Promise<boolean>,
): Promise<LockOwner> {
  const verdict = await judge(paths.lock, probes);
  if (!verdict.dead) {
    throw refusal(environment, paths.lock, verdict.reason, verdict.fix);
  }
  const recovered = await recover(paths, probes);
  if (recovered === undefined || !(await take())) {
    throw refusal(
      environment,
      paths.lock,
      "another process is recovering or has just taken it",
      `Retry shortly; if it persists, check ${paths.recovery} and ${paths.lock}.`,
    );
  }
  return recovered;
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
  const probes: LockProbes = {
    isAlive: options.isProcessAlive ?? processAlive,
    bootTime: options.bootTime ?? (() => Date.now() - uptime() * 1000),
  };
  const onRecover =
    options.onRecover ??
    ((message: string) => process.stderr.write(`${message}\n`));
  const base = join(root, ".kore", "locks");
  const lock = join(base, `${environment}.lock`);
  const paths: LockPaths = { lock, recovery: `${lock}.recovery` };
  await mkdir(base, { recursive: true });

  const owner: LockOwner = {
    pid: process.pid,
    host: hostname(),
    token: randomUUID(),
    acquiredAt: new Date().toISOString(),
  };
  const staging = join(base, `${environment}.${owner.token}.tmp`);
  const take = () => acquire(lock, staging, owner);

  if (!(await take())) {
    const recovered = await recoverStale(environment, paths, probes, take);
    onRecover(
      `recovered stale lock ${lock} left by pid ${recovered.pid} (acquired ${recovered.acquiredAt}); the previous mutation was interrupted, so check \`kore journal\` before trusting the environment state`,
    );
  }

  try {
    return await operation();
  } finally {
    // Only remove the lock if it is still ours.
    if ((await readOwner(lock))?.token === owner.token) {
      await rm(lock, { force: true });
    }
  }
}
