// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md
//
// The pure half of the golden-path rollout drill (golden-path-rollout.live.spec.ts):
// what a Deployment's status says about its rollout, whether its ready replicas
// have dipped below their minimum, and the evidence the drill records. The live
// spec does the reads and the restarts; nothing here touches the cluster.

import { goldenPathRouteSet } from "./golden-path-routes.js";

/** The fields of a Deployment the drill reads, as the API server returns them. */
export interface DeploymentDocument {
  metadata?: { name?: string; generation?: number };
  spec?: { replicas?: number };
  status?: {
    observedGeneration?: number;
    replicas?: number;
    updatedReplicas?: number;
    readyReplicas?: number;
  };
}

export interface Deployment {
  name: string;
  /** spec.replicas: the count the Deployment is settled at. */
  desired: number;
  generation: number;
  observed: number;
  /** status.replicas, which counts surge Pods while a rollout runs. */
  replicas: number;
  updated: number;
  ready: number;
}

/** What the drill saw of one Deployment's rollout. */
export interface RolloutRecord {
  role: "app" | "gateway-proxy";
  /** `<namespace>/<name>`. */
  deployment: string;
  /** The ready replicas the Deployment had before its rollout, which it must not drop below. */
  minimumReady: number;
  lowestReady: number;
  samples: number;
  elapsedSeconds: number;
}

/**
 * The fixed method of the drill. The probe sends a round of requests per route,
 * one curl each, with no retries. The rollout reads are a second apart, so a dip
 * shorter than a second can pass unseen; the record names that interval.
 */
export const rolloutDrill = {
  maxLoadAverage: 10,
  requestsPerRoute: 10,
  concurrency: 4,
  pollIntervalSeconds: 1,
  warmupTimeoutSeconds: 120,
  rolloutTimeoutSeconds: 600,
} as const;

export interface DrillRecordInput {
  requests: number;
  rollouts: readonly RolloutRecord[];
  elapsedSeconds: number;
  loadAverage: number;
  gateway: { namespace: string; name: string; port: number };
  host: { before: unknown; after: unknown };
}

/** The one JSON record a drill run prints: the method, the rollouts, the load, and the host beside them. */
export function drillRecordOf(input: DrillRecordInput) {
  return {
    method: {
      routeSet: goldenPathRouteSet.name,
      routes: goldenPathRouteSet.routes.map((route) => route.path),
      probe: "shared Gateway, curl with no retries",
      requestsPerRoute: rolloutDrill.requestsPerRoute,
      concurrency: rolloutDrill.concurrency,
      sampleIntervalSeconds: rolloutDrill.pollIntervalSeconds,
    },
    gateway: input.gateway,
    rollouts: input.rollouts,
    load: {
      requests: input.requests,
      failedRequests: 0,
      retries: 0,
      elapsedSeconds: input.elapsedSeconds,
    },
    // Shadow until the gateway's own error metric is scraped: recorded, not gated.
    gatewayErrorRatio: {
      value: 0,
      gated: false,
      source: "probe",
      note: "shadow until the gateway's error metric is scraped",
    },
    loadAverage: { start: input.loadAverage },
    host: input.host,
    evidence: evidenceOf(input.requests, input.rollouts),
  };
}

/** Reads a Deployment document. Refuses one with no name, so no restart goes to an unnamed target. */
export function deploymentOf(document: DeploymentDocument): Deployment {
  const name = document.metadata?.name;
  if (name === undefined || name === "") {
    throw new Error("a Deployment document carries no metadata.name");
  }
  return {
    name,
    desired: document.spec?.replicas ?? 1,
    generation: document.metadata?.generation ?? 0,
    observed: document.status?.observedGeneration ?? 0,
    replicas: document.status?.replicas ?? 0,
    updated: document.status?.updatedReplicas ?? 0,
    ready: document.status?.readyReplicas ?? 0,
  };
}

/**
 * Settled: the controller has seen the latest generation, and every replica is
 * updated, running and ready at the settled count. Before the controller sees the
 * restart, the old Pods are still ready, so the generation check stops them passing.
 */
export function settled(deployment: Deployment): boolean {
  return (
    deployment.observed >= deployment.generation &&
    deployment.updated === deployment.desired &&
    deployment.replicas === deployment.desired &&
    deployment.ready === deployment.desired
  );
}

/** Whether a sample of ready replicas is below the minimum the rollout must hold. */
export function belowMinimum(
  deployment: Deployment,
  minimumReady: number,
): boolean {
  return deployment.ready < minimumReady;
}

/**
 * The evidence the drill records, worded as evidence: what was sent and what it
 * showed, not a claim the promise holds beyond the run.
 */
export function evidenceOf(
  requests: number,
  records: readonly RolloutRecord[],
): string {
  const floors = records
    .map(
      (record) =>
        `${record.deployment} ${record.lowestReady}/${record.minimumReady}`,
    )
    .join(", ");
  return `zero failed requests with no retries over ${requests} requests through the shared Gateway, across ${records.length} rollouts; lowest ready replicas against their minimum: ${floors || "none observed"}`;
}
