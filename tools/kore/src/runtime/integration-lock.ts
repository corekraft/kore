import { findRoot } from "../config/config.js";
import { holdEnvironmentLock, inheritsLock } from "./lock.js";

// Docs: AGENTS.md "Mutations are serialized per environment."

/** Ten minutes: long enough for a `kore local up` already running to finish. */
const DEFAULT_WAIT_MS = 10 * 60 * 1000;

interface ProcessHooks {
  on: (event: string, handler: () => void) => unknown;
  exit: (code: number) => unknown;
}

interface HoldOptions {
  root?: () => Promise<string>;
  process?: ProcessHooks;
  waitMs?: number;
}

/**
 * Holds the environment lock for the whole test process, the same lock
 * `kore local up` and every other mutating command take. Loaded through
 * `node --import` by every `test:integration*` script, so no live spec can
 * mutate the cluster unserialized, however many specs exist.
 *
 * Without `KORE_RUN_INTEGRATION=1` it does nothing. It waits for a running
 * kore mutation (`KORE_INTEGRATION_LOCK_WAIT_MS`, ten minutes by default),
 * then fails naming the holder. The token is exported, so the child process
 * `node --test` starts for each spec file (which loads this module again)
 * and every kore command a spec runs nest under it instead of deadlocking.
 * The lock is released on exit and on SIGINT/SIGTERM.
 */
export async function holdIntegrationLock(
  options: HoldOptions = {},
): Promise<void> {
  if (process.env.KORE_RUN_INTEGRATION !== "1") {
    return;
  }
  const environment = process.env.KORE_INTEGRATION_ENVIRONMENT ?? "local";
  const root = await (options.root ?? findRoot)();
  const lock = `${root}/.kore/locks/${environment}.lock`;
  if (await inheritsLock(lock, environment)) {
    return;
  }
  const waitMs =
    options.waitMs ??
    Number(process.env.KORE_INTEGRATION_LOCK_WAIT_MS ?? DEFAULT_WAIT_MS);
  const held = await holdEnvironmentLock(root, environment, { waitMs });
  const hooks = options.process ?? process;
  hooks.on("exit", held.releaseSync);
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    hooks.on(signal, () => {
      held.releaseSync();
      hooks.exit(code);
    });
  }
}
