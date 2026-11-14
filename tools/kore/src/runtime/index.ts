// Docs: docs/decisions/0002-tool-responsibility-boundaries.md
export {
  HELD_LOCK_ENV,
  holdEnvironmentLock,
  withEnvironmentLock,
} from "./lock.js";
export type { HeldLock, LockOptions } from "./lock.js";
export { holdLiveLock } from "./live-lock.js";
export { judge } from "./lock-recovery.js";
export {
  isSensitiveName,
  readJournal,
  redactionMarker,
  summarizeOperations,
  withJournal,
} from "./journal.js";
export type {
  JournalEntry,
  JournalOperation,
  OperationSummary,
} from "./journal.js";
export { environmentStatePath } from "./environment-state.js";
export { processAlive } from "./lock-owner.js";
export { HOST_LEASE, holdsHostLease, withHostLease } from "./host-lease.js";
export { hostRoot, lockScope } from "./host-locks.js";
export { liveEnvironment } from "./live-environment.js";
export {
  CommandError,
  CommandTimeoutError,
  ProcessRunner,
  withSignal,
} from "./runner.js";
export type {
  ProcessRunnerOptions,
  RunOptions,
  RunResult,
  Runner,
} from "./runner.js";
export { withRequestTimeout } from "./request-timeout.js";
export { withHelmDeadline } from "./helm-timeout.js";
export {
  isTransientKubectlFailure,
  TransientFailureError,
  withTransientRetry,
} from "./retry.js";
export type { TransientRetryOptions } from "./retry.js";
export { listHostProcesses, terminateMatching } from "./processes.js";
export type { ProcessControl, ProcessEntry } from "./processes.js";
export { RecordingRunner } from "./runner.js";
