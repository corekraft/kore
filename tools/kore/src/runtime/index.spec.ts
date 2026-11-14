// Docs: docs/decisions/0002-tool-responsibility-boundaries.md
import { expect, test, vi } from "vitest";
import * as runtime from "./index.js";
import * as environmentState from "./environment-state.js";
import * as helmTimeout from "./helm-timeout.js";
import * as hostLease from "./host-lease.js";
import * as hostLocks from "./host-locks.js";
import * as journal from "./journal.js";
import * as liveEnvironment from "./live-environment.js";
import * as lock from "./lock.js";
import * as lockOwner from "./lock-owner.js";
import * as processes from "./processes.js";
import * as requestTimeout from "./request-timeout.js";
import * as retry from "./retry.js";
import * as runner from "./runner.js";

vi.mock("./environment-state.js");
vi.mock("./helm-timeout.js");
vi.mock("./host-lease.js");
vi.mock("./host-locks.js");
vi.mock("./journal.js");
vi.mock("./live-environment.js");
vi.mock("./lock.js");
vi.mock("./lock-owner.js");
vi.mock("./processes.js");
vi.mock("./request-timeout.js");
vi.mock("./retry.js");
vi.mock("./runner.js");

test("the runtime barrel exposes exactly the runtime entry points", () => {
  expect(Object.keys(runtime).sort()).toEqual([
    "CommandError",
    "CommandTimeoutError",
    "HOST_LEASE",
    "ProcessRunner",
    "RecordingRunner",
    "TransientFailureError",
    "environmentStatePath",
    "holdEnvironmentLock",
    "holdsHostLease",
    "hostRoot",
    "isSensitiveName",
    "isTransientKubectlFailure",
    "listHostProcesses",
    "liveEnvironment",
    "lockScope",
    "processAlive",
    "readJournal",
    "redactionMarker",
    "summarizeOperations",
    "terminateMatching",
    "withEnvironmentLock",
    "withHelmDeadline",
    "withHostLease",
    "withJournal",
    "withRequestTimeout",
    "withSignal",
    "withTransientRetry",
  ]);
});

test("each barrel export is the same binding as its source module's export", () => {
  expect(runtime.holdEnvironmentLock).toBe(lock.holdEnvironmentLock);
  expect(runtime.withEnvironmentLock).toBe(lock.withEnvironmentLock);
  expect(runtime.isSensitiveName).toBe(journal.isSensitiveName);
  expect(runtime.readJournal).toBe(journal.readJournal);
  expect(runtime.redactionMarker).toBe(journal.redactionMarker);
  expect(runtime.summarizeOperations).toBe(journal.summarizeOperations);
  expect(runtime.withJournal).toBe(journal.withJournal);
  expect(runtime.environmentStatePath).toBe(
    environmentState.environmentStatePath,
  );
  expect(runtime.processAlive).toBe(lockOwner.processAlive);
  expect(runtime.HOST_LEASE).toBe(hostLease.HOST_LEASE);
  expect(runtime.holdsHostLease).toBe(hostLease.holdsHostLease);
  expect(runtime.withHostLease).toBe(hostLease.withHostLease);
  expect(runtime.hostRoot).toBe(hostLocks.hostRoot);
  expect(runtime.lockScope).toBe(hostLocks.lockScope);
  expect(runtime.liveEnvironment).toBe(liveEnvironment.liveEnvironment);
  expect(runtime.CommandError).toBe(runner.CommandError);
  expect(runtime.CommandTimeoutError).toBe(runner.CommandTimeoutError);
  expect(runtime.ProcessRunner).toBe(runner.ProcessRunner);
  expect(runtime.withSignal).toBe(runner.withSignal);
  expect(runtime.RecordingRunner).toBe(runner.RecordingRunner);
  expect(runtime.withRequestTimeout).toBe(requestTimeout.withRequestTimeout);
  expect(runtime.withHelmDeadline).toBe(helmTimeout.withHelmDeadline);
  expect(runtime.isTransientKubectlFailure).toBe(
    retry.isTransientKubectlFailure,
  );
  expect(runtime.TransientFailureError).toBe(retry.TransientFailureError);
  expect(runtime.withTransientRetry).toBe(retry.withTransientRetry);
  expect(runtime.listHostProcesses).toBe(processes.listHostProcesses);
  expect(runtime.terminateMatching).toBe(processes.terminateMatching);
});
