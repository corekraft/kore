import { hostRoot } from "./host-locks.js";
import { withEnvironmentLock, type LockOptions } from "./lock.js";

// Docs: docs/decisions/0002-tool-responsibility-boundaries.md

/** The lock name of the host lease, beside the per-cluster locks. */
export const HOST_LEASE = "host-lease";

/**
 * Runs `operation` holding the exclusive host lease. A live run (`kore local
 * up`, the live integration specs) takes it, so no second live run, new
 * writer session or hook test run piles load onto a host already running a
 * cluster. It is an ordinary lock in the host lock directory, with the same
 * stale-owner recovery as a cluster's lock.
 */
export async function withHostLease<T>(
  operation: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  return await withEnvironmentLock(hostRoot(), HOST_LEASE, operation, options);
}
