import {
  crdOwners,
  providerOwnsCrd,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { backupStatus, type BackupStatus } from "./backup-status.js";
import { capacityStatus, type CapacityStatus } from "./capacity-status.js";
import { errorMessage } from "./probe.js";
import { platformStatus, type ComponentStatus } from "./status.js";

// Docs: docs/decisions/0057-runtime-crd-ownership.md

export const crdOwnershipStatusName = "crd-ownership";

export interface CrdOwnershipFindings {
  total: number;
  /** Cluster CRDs no catalog component owns. */
  unowned: string[];
  /** Cluster CRDs owned by more than one component. */
  multiple: { name: string; owners: string[] }[];
  /** Cluster CRDs in a group the environment declares provider-owned (ADR 0088). */
  providerOwned: string[];
}

export interface CrdOwnershipStatus {
  name: string;
  namespace: string;
  status: "ready" | "missing" | "degraded";
  detail: string;
  crds?: CrdOwnershipFindings;
}

/** Splits cluster CRDs into unowned, multiply owned and provider-owned. */
function classifyCrds(
  repository: Repository,
  names: string[],
): Pick<CrdOwnershipFindings, "unowned" | "multiple" | "providerOwned"> {
  const unowned: string[] = [];
  const multiple: CrdOwnershipFindings["multiple"] = [];
  const providerOwned: string[] = [];
  for (const name of names) {
    if (providerOwnsCrd(repository.environment.providerOwnedCRDGroups, name)) {
      providerOwned.push(name);
      continue;
    }
    const owners = crdOwners(repository.catalog.components, name);
    if (owners.length === 0) {
      unowned.push(name);
    } else if (owners.length > 1) {
      multiple.push({ name, owners });
    }
  }
  return { unowned, multiple, providerOwned };
}

/**
 * Reports every CRD in the configured context that has no catalog owner or
 * more than one. Read-only and audit-only: it never fails `platform up`.
 */
export async function crdOwnershipStatus(
  repository: Repository,
  runner: Runner,
): Promise<CrdOwnershipStatus> {
  const identity = { name: crdOwnershipStatusName, namespace: "cluster" };
  let names: string[];
  try {
    const { stdout } = await runner.run(
      "kubectl",
      [
        "--context",
        repository.environment.kubeContext,
        "get",
        "crd",
        "--output",
        "json",
      ],
      { capture: true },
    );
    const list = JSON.parse(stdout) as {
      items?: { metadata?: { name?: string } }[];
    };
    names = (list.items ?? [])
      .map((item) => item.metadata?.name)
      .filter((name): name is string => name !== undefined)
      .sort();
  } catch (error) {
    return {
      ...identity,
      status: "missing",
      detail: `CRDs could not be listed: ${errorMessage(error)}`,
    };
  }
  const { unowned, multiple, providerOwned } = classifyCrds(repository, names);
  const crds = { total: names.length, unowned, multiple, providerOwned };
  const problems = [
    ...unowned.map((name) => `${name} has no catalog owner`),
    ...multiple.map(
      ({ name, owners }) =>
        `${name} has several owners: ${owners.join(" and ")}`,
    ),
  ];
  return problems.length === 0
    ? {
        ...identity,
        status: "ready",
        detail:
          providerOwned.length === 0
            ? `all ${names.length} CRDs have exactly one catalog owner`
            : `all ${names.length} CRDs have exactly one owner: ${names.length - providerOwned.length} catalog-owned, ${providerOwned.length} provider-owned`,
        crds,
      }
    : {
        ...identity,
        status: "degraded",
        detail: `${problems.join("; ")}. Declare each in one component's ownsCRDs or ownsCRDGroups, or in the environment's providerOwnedCRDGroups when the provider ships it`,
        crds,
      };
}

/**
 * `kore platform status` output: the gating rows of `platformStatus` plus the
 * audit-only CRD ownership row (ADR 0057), capacity row (resource budgets), and backups row (ADR 0074). Bootstrap and `app up` call
 * `platformStatus` directly, so the audit never gates them. A filtered query
 * omits the platform-wide row.
 */
export async function platformStatusReport(
  repository: Repository,
  runner: Runner,
  only?: readonly string[],
): Promise<
  (ComponentStatus | CrdOwnershipStatus | CapacityStatus | BackupStatus)[]
> {
  const rows: (
    ComponentStatus | CrdOwnershipStatus | CapacityStatus | BackupStatus
  )[] = await platformStatus(repository, runner, only);
  if (!only) {
    rows.push(await crdOwnershipStatus(repository, runner));
    rows.push(await capacityStatus(repository, runner));
    // Host-side artifact metadata plus `kubectl get`; audit-only (ADR 0074).
    const backups = await backupStatus(repository, runner);
    if (backups) {
      rows.push(backups);
    }
  }
  return rows;
}
