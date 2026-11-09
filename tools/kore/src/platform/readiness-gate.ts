import type { Repository } from "../config/index.js";
import { assertExpectedCluster } from "../cluster/index.js";
import type { Runner } from "../runtime/index.js";
import {
  assertAdmissionGateOpen,
  ensureClosedAdmissionGate,
  openAdmissionGate,
  readAdmissionGate,
} from "./admission-gate.js";
import {
  evaluateReadiness,
  readinessFailureSummary,
  recordReadinessEvidence,
  tryRecordReadinessEvidence,
  type ReadinessEvidence,
} from "./readiness-manifest.js";
import { imageInventoryStatusName, platformStatus } from "./status.js";

// Docs: docs/decisions/0067-platform-readiness-manifest-and-evidence.md

/**
 * Opens the gate only when the readiness manifest passes in this run (ADR
 * 0067). Order is the safety property: the evidence is recorded before the gate
 * opens, so an open gate always has evidence behind it; a failed or interrupted
 * run leaves the gate closed; and success is reported only after the gate reads
 * back as open for this generation.
 */
export async function openApplicationAdmission(
  repository: Repository,
  runner: Runner,
): Promise<ReadinessEvidence> {
  const rows = await platformStatus(repository, runner);
  // Audit findings never fail the run, so the log is where a run shows them.
  const inventory = rows.find(({ name }) => name === imageInventoryStatusName);
  if (inventory) {
    process.stderr.write(`image inventory: ${inventory.detail}\n`);
  }
  const evidence = evaluateReadiness(repository, rows);
  if (evidence.state !== "open") {
    // Close first: nothing that can fail afterwards may leave the gate open.
    await ensureClosedAdmissionGate(repository, runner);
    await tryRecordReadinessEvidence(repository, runner, evidence, (message) =>
      process.stderr.write(`${message}\n`),
    );
    throw new Error(
      `the application admission gate stays closed: ${readinessFailureSummary(evidence)}. Fix the failing prerequisite and rerun kore platform up`,
    );
  }
  await recordReadinessEvidence(repository, runner, evidence);
  await openAdmissionGate(repository, runner);
  await assertAdmissionGateOpen(repository, runner);
  return evidence;
}

export interface GateCheckResult {
  /** True when this call closed a gate that was open or stale. */
  closed: boolean;
  evidence: ReadinessEvidence;
  failures: ReadinessEvidence["failures"];
}

/**
 * Closes the gate when a required platform capability is unhealthy, so no new
 * application mutation is admitted (ADR 0067). It only ever closes: opening is
 * bootstrap's alone. It writes the gate and its evidence and nothing else, so
 * running workloads keep running.
 */
export async function closeGateIfDegraded(
  repository: Repository,
  runner: Runner,
): Promise<GateCheckResult> {
  await assertExpectedCluster(repository, runner);
  const rows = await platformStatus(repository, runner);
  const evidence = evaluateReadiness(repository, rows);
  const failures = evidence.failures;
  if (failures.length === 0) {
    return { closed: false, evidence, failures };
  }
  const gate = await readAdmissionGate(repository, runner);
  if (gate === undefined) {
    return { closed: false, evidence, failures };
  }
  const closed = gate.state !== "closed";
  await ensureClosedAdmissionGate(repository, runner);
  await tryRecordReadinessEvidence(repository, runner, evidence, (message) =>
    process.stderr.write(`${message}\n`),
  );
  return { closed, evidence, failures };
}
