import { newestVerifiedExport, retainedResources } from "../cluster/index.js";
import type { Repository } from "../config/index.js";
import { loadRecovery } from "../ops/index.js";
import type { Runner } from "../runtime/index.js";
import { errorMessage } from "./probe.js";

// Docs: docs/operations/backups.md, docs/decisions/0074-backup-freshness-row.md

export const backupStatusName = "backups";

export interface BackupFindings {
  rpoMinutes: number;
  /** Whole minutes since the newest verified export; null when there is none. */
  ageMinutes: number | null;
}

export interface BackupStatus {
  name: string;
  namespace: string;
  status: "ready" | "missing" | "degraded";
  detail: string;
  backup?: BackupFindings;
}

/**
 * Compares the newest verified export with the retained-data RPO declared in
 * infra/catalog/recovery.yaml. Read-only and audit-only: it reads manifest
 * metadata and `kubectl get`, never decrypts, and never fails `platform up`.
 * Environments with no data-export objective (managed, until Step 7) get no row.
 */
export async function backupStatus(
  repository: Repository,
  runner: Runner,
  now: Date = new Date(),
): Promise<BackupStatus | undefined> {
  const environment = repository.environment.name;
  const objective = (await loadRecovery(repository.root)).find(
    (candidate) =>
      candidate.protection === "data-export" &&
      candidate.environment ===
        (environment === "local" ? "local" : "managed") &&
      candidate.rpoMinutes !== null,
  );
  if (!objective || objective.rpoMinutes === null) {
    return undefined;
  }
  const rpoMinutes = objective.rpoMinutes;
  const identity = { name: backupStatusName, namespace: "cluster" };
  let retained: string[];
  try {
    retained = await retainedResources(repository, runner);
  } catch (error) {
    return {
      ...identity,
      status: "missing",
      detail: `retained data could not be listed: ${errorMessage(error)}`,
    };
  }
  if (retained.length === 0) {
    return {
      ...identity,
      status: "ready",
      detail: "no retained data exists, so nothing needs a backup",
      backup: { rpoMinutes, ageMinutes: null },
    };
  }
  const remedy = `kore data export --environment ${environment}`;
  const newest = await newestVerifiedExport(repository);
  if (!newest) {
    return {
      ...identity,
      status: "degraded",
      detail: `retained data exists but there is no export; the RPO is ${rpoMinutes} minutes. Run ${remedy}`,
      backup: { rpoMinutes, ageMinutes: null },
    };
  }
  const ageMinutes = Math.max(
    0,
    Math.floor((now.getTime() - newest.getTime()) / 60_000),
  );
  const backup = { rpoMinutes, ageMinutes };
  return ageMinutes > rpoMinutes
    ? {
        ...identity,
        status: "degraded",
        detail: `the newest export is ${ageMinutes} minutes old, older than the ${rpoMinutes}-minute RPO. Run ${remedy}`,
        backup,
      }
    : {
        ...identity,
        status: "ready",
        detail: `the newest export is ${ageMinutes} minutes old (RPO ${rpoMinutes} minutes)`,
        backup,
      };
}
