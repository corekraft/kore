import {
  featureEnabled,
  postgresqlServiceClassInstancesFlag,
} from "./features.js";
import type { Environment } from "./types.js";

// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md

/**
 * With postgresql-service-class-instances on, the value the PostgreSQL composition
 * takes to derive its instances and sizing from the claim's serviceClass (ADR 0154).
 * Only the API chart takes it; off, none is passed, so the composition renders the
 * one-instance Cluster it rendered before.
 */
export function serviceClassArgs(
  environment: Environment,
  component: string,
): string[] {
  if (
    component !== "kore-postgresql-api" ||
    !featureEnabled(environment, postgresqlServiceClassInstancesFlag)
  ) {
    return [];
  }
  return ["--set", "serviceClassInstances=true"];
}
