import { open, rm, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { errorCode, readLock, type LockOwner } from "./lock-owner.js";

// Clock and uptime readings differ by a little; only a clear gap proves a reboot.
const BOOT_TOLERANCE_MS = 60_000;

export interface LockPaths {
  lock: string;
  recovery: string;
}

export interface LockProbes {
  isAlive: (pid: number) => boolean;
  bootTime: () => number;
}

export type Verdict =
  | { dead: true; owner: LockOwner }
  | { dead: false; reason: string; fix: string; live?: true; gone?: true };

export function refusal(
  environment: string,
  lock: string,
  detail: string,
  fix: string,
): Error {
  return new Error(
    `another mutation is already running for environment ${environment}: ${detail} (lock ${lock}). ${fix}`,
  );
}

/** Returns a description of the dead owner, or the reason it cannot be recovered. */
export async function judge(
  lock: string,
  probes: LockProbes,
): Promise<Verdict> {
  const current = await readLock(lock);
  const manual = `If no kore process is running, remove it with: rm -rf ${lock}`;
  if (current === "gone") {
    // The holder released between the failed attempt and this read.
    return {
      dead: false,
      reason: "the lock was released while it was being inspected",
      fix: "Retry.",
      gone: true,
    };
  }
  if (current === undefined) {
    return {
      dead: false,
      reason: "its owner is unknown (legacy or malformed lock)",
      fix: manual,
    };
  }
  if (current.host !== hostname()) {
    return {
      dead: false,
      reason: `held by pid ${current.pid} on host ${current.host}, which cannot be checked from here`,
      fix: manual,
    };
  }
  const predatesBoot =
    Date.parse(current.acquiredAt) < probes.bootTime() - BOOT_TOLERANCE_MS;
  if (probes.isAlive(current.pid) && !predatesBoot) {
    return {
      dead: false,
      reason: `held by running pid ${current.pid}`,
      fix: "Wait for it to finish, or stop that process.",
      live: true,
    };
  }
  return { dead: true, owner: current };
}

/** Breaks the stale lock; only one concurrent caller can hold the recovery lock. */
export async function recover(
  paths: LockPaths,
  probes: LockProbes,
): Promise<LockOwner | undefined> {
  let handle;
  try {
    handle = await open(paths.recovery, "wx");
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      return undefined;
    }
    throw error;
  }
  try {
    // Re-judge under the recovery lock: the lock may have changed hands.
    const verdict = await judge(paths.lock, probes);
    if (!verdict.dead) {
      return undefined;
    }
    await unlink(paths.lock);
    return verdict.owner;
  } finally {
    await handle.close();
    await rm(paths.recovery, { force: true });
  }
}
