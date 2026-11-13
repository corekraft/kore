import { loadRepository } from "../config/config.js";
import { hostRoot, lockScope } from "./host-locks.js";
import { HOST_LEASE } from "./host-lease.js";
import { isSet, liveEnvironment } from "./live-environment.js";
import { holdEnvironmentLock, inheritsLock, type HeldLock } from "./lock.js";

// Docs: AGENTS.md "Mutations are serialized per environment."

/** Ten minutes: long enough for a `kore local up` already running to finish. */
const DEFAULT_WAIT_MS = 10 * 60 * 1000;

interface ProcessHooks {
  on: (event: string, handler: () => void) => unknown;
  exit: (code: number) => unknown;
}

interface HoldOptions {
  /** The lock key; defaults to the cluster of `KORE_LIVE_ENVIRONMENT`. */
  scope?: () => Promise<string>;
  process?: ProcessHooks;
  waitMs?: number;
}

/**
 * Holds the environment lock for the whole test process, the same lock
 * `kore local up` and every other mutating command take, after the exclusive
 * host lease a live run holds. Loaded through
 * `node --import` by every `test:live*` script, so no live spec can
 * mutate the cluster unserialized, however many specs exist.
 *
 * Without `KORE_RUN_LIVE=1` it does nothing. It waits for a running
 * kore mutation (`KORE_LIVE_LOCK_WAIT_MS`, ten minutes by default),
 * then fails naming the holder. The token is exported, so the child process
 * `node --test` starts for each spec file (which loads this module again)
 * and every kore command a spec runs nest under it instead of deadlocking.
 * The lock is released on exit and on SIGINT/SIGTERM.
 */
export async function holdLiveLock(options: HoldOptions = {}): Promise<void> {
  // The retired names would be ignored, not refused: the switch would skip the live specs, the wait would silently change.
  if (isSet(process.env.KORE_RUN_INTEGRATION)) {
    throw new Error(
      "KORE_RUN_INTEGRATION is retired; set KORE_RUN_LIVE=1 instead (the live specs were renamed from integration specs)",
    );
  }
  if (isSet(process.env.KORE_INTEGRATION_LOCK_WAIT_MS)) {
    throw new Error(
      "KORE_INTEGRATION_LOCK_WAIT_MS is retired; set KORE_LIVE_LOCK_WAIT_MS instead (the live specs were renamed from integration specs)",
    );
  }
  if (process.env.KORE_RUN_LIVE !== "1") {
    return;
  }
  const environment = liveEnvironment();
  const scope = await (
    options.scope ??
    (async () => lockScope((await loadRepository(environment)).environment))
  )();
  const root = hostRoot();
  const lock = `${root}/.kore/locks/${scope}.lock`;
  if (await inheritsLock(lock, scope)) {
    return;
  }
  const waitMs =
    options.waitMs ??
    Number(process.env.KORE_LIVE_LOCK_WAIT_MS ?? DEFAULT_WAIT_MS);
  // The live run is exclusive on the host first (the lease), then on its cluster.
  const lease = await holdEnvironmentLock(root, HOST_LEASE, { waitMs });
  let held: HeldLock;
  try {
    held = await holdEnvironmentLock(root, scope, { waitMs });
  } catch (error) {
    await lease.release();
    throw error;
  }
  const releaseSync = () => {
    held.releaseSync();
    lease.releaseSync();
  };
  const hooks = options.process ?? process;
  hooks.on("exit", releaseSync);
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    hooks.on(signal, () => {
      releaseSync();
      hooks.exit(code);
    });
  }
}
