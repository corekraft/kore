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
  /** How long to wait for a live holder to finish. Defaults to 0 (fail at once). */
  waitMs?: number;
  /** Interval between attempts while waiting. Defaults to 1000 ms. */
  pollMs?: number;
}

/**
 * Exported by a lock holder as `<environment>:<token>`, so a kore call made
 * while the lock is held (in this process or a child) nests instead of
 * deadlocking on the lock its own caller holds.
 */
export const HELD_LOCK_ENV = "KORE_HELD_ENVIRONMENT_LOCK";

export interface HeldLock {
  /** Releases the lock if it is still ours. Safe to call more than once. */
  release: () => Promise<void>;
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

/** Whether this process was handed the environment's lock by its holder. */
async function inheritsLock(lock: string, environment: string) {
  const [name, token] = (process.env[HELD_LOCK_ENV] ?? "").split(":");
  return (
    name === environment &&
    token !== undefined &&
    (await readOwner(lock))?.token === token
  );
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Takes the lock, waiting for a live holder or recovering a provably dead one. */
async function acquireOrWait(
  environment: string,
  paths: LockPaths,
  probes: LockProbes,
  options: LockOptions,
  take: () => Promise<boolean>,
): Promise<void> {
  const onRecover =
    options.onRecover ??
    ((message: string) => process.stderr.write(`${message}\n`));
  const waitMs = options.waitMs ?? 0;
  const pollMs = options.pollMs ?? 1000;
  const lock = paths.lock;
  const deadline = Date.now() + waitMs;
  while (!(await take())) {
    const verdict = await judge(lock, probes);
    if (!verdict.dead && verdict.live === true && Date.now() < deadline) {
      await sleep(Math.min(pollMs, Math.max(deadline - Date.now(), 1)));
      continue;
    }
    if (!verdict.dead && verdict.live === true && waitMs > 0) {
      throw refusal(
        environment,
        lock,
        `${verdict.reason}; waited ${waitMs} ms`,
        verdict.fix,
      );
    }
    const recovered = await recoverStale(environment, paths, probes, take);
    onRecover(
      `recovered stale lock ${lock} left by pid ${recovered.pid} (acquired ${recovered.acquiredAt}); the previous mutation was interrupted, so check \`kore journal\` before trusting the environment state`,
    );
    break;
  }
}

/**
 * Takes the environment's lock and returns a handle that releases it.
 *
 * The lock is a file created with `link`, so it appears atomically with its
 * owner record. A lock is recovered only when its owner is provably dead on this
 * host: the pid is gone, or the lock predates the host's boot (which survives
 * pid reuse). Anything unprovable (other host, legacy directory lock,
 * malformed record) is refused at once, because breaking a live lock is worse
 * than asking for manual removal. A live holder is waited for up to
 * `options.waitMs`, then refused naming the holder.
 *
 * While held, the token is exported in `HELD_LOCK_ENV`, so nested kore calls
 * (in this process or children it spawns) pass through. This is for a caller
 * that runs kore on its own behalf, such as an integration spec; kore's own
 * `withEnvironmentLock` does not export it, so concurrent in-process
 * mutations still exclude each other.
 */
export async function holdEnvironmentLock(
  root: string,
  environment: string,
  options: LockOptions = {},
): Promise<HeldLock> {
  return await takeLock(root, environment, options, true);
}

async function takeLock(
  root: string,
  environment: string,
  options: LockOptions,
  exportToken: boolean,
): Promise<HeldLock> {
  const probes: LockProbes = {
    isAlive: options.isProcessAlive ?? processAlive,
    bootTime: options.bootTime ?? (() => Date.now() - uptime() * 1000),
  };
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

  await acquireOrWait(environment, paths, probes, options, take);

  const previous = process.env[HELD_LOCK_ENV];
  if (exportToken) {
    process.env[HELD_LOCK_ENV] = `${environment}:${owner.token}`;
  }
  let released = false;
  return {
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      if (exportToken) {
        if (previous === undefined) {
          delete process.env[HELD_LOCK_ENV];
        } else {
          process.env[HELD_LOCK_ENV] = previous;
        }
      }
      // Only remove the lock if it is still ours.
      if ((await readOwner(lock))?.token === owner.token) {
        await rm(lock, { force: true });
      }
    },
  };
}

/** Runs `operation` while holding the environment's lock (see `holdEnvironmentLock`). */
export async function withEnvironmentLock<T>(
  root: string,
  environment: string,
  operation: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const lock = join(root, ".kore", "locks", `${environment}.lock`);
  if (await inheritsLock(lock, environment)) {
    return await operation();
  }
  const held = await takeLock(root, environment, options, false);
  try {
    return await operation();
  } finally {
    await held.release();
  }
}
