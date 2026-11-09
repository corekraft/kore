import { crdOwners, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
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
}

export interface CrdOwnershipStatus {
  name: string;
  namespace: string;
  status: "ready" | "missing" | "degraded";
  detail: string;
  crds?: CrdOwnershipFindings;
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
  const unowned: string[] = [];
  const multiple: CrdOwnershipFindings["multiple"] = [];
  for (const name of names) {
    const owners = crdOwners(repository.catalog.components, name);
    if (owners.length === 0) {
      unowned.push(name);
    } else if (owners.length > 1) {
      multiple.push({ name, owners });
    }
  }
  const crds = { total: names.length, unowned, multiple };
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
        detail: `all ${names.length} CRDs have exactly one catalog owner`,
        crds,
      }
    : {
        ...identity,
        status: "degraded",
        detail: `${problems.join("; ")}. Declare each in one component's ownsCRDs or ownsCRDGroups`,
        crds,
      };
}

/**
 * `kore platform status` output: the gating rows of `platformStatus` plus the
 * audit-only CRD ownership row (ADR 0057). Bootstrap and `app up` call
 * `platformStatus` directly, so the audit never gates them. A filtered query
 * omits the platform-wide row.
 */
export async function platformStatusReport(
  repository: Repository,
  runner: Runner,
  only?: readonly string[],
): Promise<(ComponentStatus | CrdOwnershipStatus)[]> {
  const rows: (ComponentStatus | CrdOwnershipStatus)[] = await platformStatus(
    repository,
    runner,
    only,
  );
  if (!only) {
    rows.push(await crdOwnershipStatus(repository, runner));
  }
  return rows;
}
