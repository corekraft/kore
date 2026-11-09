import { before, after } from "node:test";
import { findRoot } from "../config/config.js";
import { holdEnvironmentLock, type HeldLock } from "./lock.js";

// Docs: AGENTS.md "Mutations are serialized per environment."

/** Ten minutes: long enough for a `kore local up` already running to finish. */
const DEFAULT_WAIT_MS = 10 * 60 * 1000;

type Hook = () => Promise<void>;

interface SpecLockOptions {
  before?: (fn: Hook) => void;
  after?: (fn: Hook) => void;
  root?: () => Promise<string>;
}

/**
 * Makes an opt-in live spec file hold the environment lock for its whole run,
 * the same lock `kore local up` and the other mutating commands take. Call it
 * once at the top of every `*.integration.spec.ts` that mutates the cluster.
 *
 * It waits for a running kore mutation (up to `KORE_INTEGRATION_LOCK_WAIT_MS`,
 * ten minutes by default) and then fails naming the holder. The lock token is
 * exported, so kore commands the spec runs itself, in process or as children,
 * nest under it instead of deadlocking. Without `KORE_RUN_INTEGRATION=1` the
 * specs skip and no lock is taken.
 */
export function lockEnvironmentForSpec(
  environment: string,
  options: SpecLockOptions = {},
): void {
  let held: HeldLock | undefined;
  (options.before ?? before)(async () => {
    if (process.env.KORE_RUN_INTEGRATION !== "1") {
      return;
    }
    const root = await (options.root ?? findRoot)();
    const waitMs = Number(
      process.env.KORE_INTEGRATION_LOCK_WAIT_MS ?? DEFAULT_WAIT_MS,
    );
    held = await holdEnvironmentLock(root, environment, { waitMs });
  });
  (options.after ?? after)(async () => {
    await held?.release();
    held = undefined;
  });
}
