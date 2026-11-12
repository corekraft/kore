import type { Environment } from "./types.js";

export type MinikubeCluster = NonNullable<Environment["cluster"]>;

/**
 * The Minikube settings of an environment. A k3d overlay has none, so a caller
 * that reaches here with one fails with the cause, never an untyped read.
 */
export function minikubeCluster(environment: Environment): MinikubeCluster {
  if (environment.cluster === undefined) {
    throw new Error(
      `environment ${environment.name} has no Minikube cluster settings; it is a ${environment.provider} overlay, so Minikube commands do not apply to it`,
    );
  }
  return environment.cluster;
}
