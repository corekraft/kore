// Docs: docs/decisions/0002-tool-responsibility-boundaries.md
export { holdEnvironmentLock, withEnvironmentLock } from "./lock.js";
export type { HeldLock, LockOptions } from "./lock.js";
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
export { CommandError, ProcessRunner, withSignal } from "./runner.js";
export type { RunOptions, RunResult, Runner } from "./runner.js";
export {
  isTransientKubectlFailure,
  TransientFailureError,
  withTransientRetry,
} from "./retry.js";
export type { TransientRetryOptions } from "./retry.js";
