import { loadRepository, type Repository } from "../config/index.js";

const gatewayFlags = [
  "ingress-agentgateway",
  "gateway-class-change-release",
  "gateway-rollback-order",
  "agentgateway-mesh-enrollment",
] as const;

/**
 * The repository with the agentgateway flags pinned off, so a spec that
 * proves the Istio path does not depend on what the committed overlay turns on.
 */
export function withGatewayFlagsOff(repository: Repository): Repository {
  const features: Record<string, boolean> = {
    ...repository.environment.features,
  };
  for (const flag of gatewayFlags) {
    features[flag] = false;
  }
  return {
    ...repository,
    environment: { ...repository.environment, features },
  };
}

/** The local repository with the agentgateway flags pinned off. */
export async function loadLocalGatewayFlagsOff(): Promise<Repository> {
  return withGatewayFlagsOff(await loadRepository("local"));
}
