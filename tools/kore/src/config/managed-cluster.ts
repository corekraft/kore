import type { Environment } from "./types.js";

export type ManagedCluster = NonNullable<Environment["cluster"]>;

/**
 * The cluster settings a managed environment declares. A k3d overlay has none,
 * so a caller that reaches here with one fails with the cause, never an
 * untyped read.
 */
export function managedCluster(environment: Environment): ManagedCluster {
  if (environment.cluster === undefined) {
    throw new Error(
      `environment ${environment.name} has no cluster settings; it is a ${environment.provider} overlay, so managed-cluster settings do not apply to it`,
    );
  }
  return environment.cluster;
}
