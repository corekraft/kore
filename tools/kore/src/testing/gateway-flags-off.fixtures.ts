import { loadRepository, type Repository } from "../config/index.js";

// The flags a spec pins off so it does not depend on the committed local
// overlay: the agentgateway flags, the three that PR #1574 turned on in local
// (registry-by-name, database-routes, otlp-route), platform-dns (#1682), and
// platform-portal (#1715 turns it on in local).
const gatewayFlags = [
  "ingress-agentgateway",
  "gateway-class-change-release",
  "gateway-rollback-order",
  "agentgateway-mesh-enrollment",
  "registry-by-name",
  "database-routes",
  "otlp-route",
  "platform-dns",
  "platform-portal",
] as const;

/**
 * The repository with the gateway and traffic flags pinned off, so a spec that
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

/** The repository with platform-dns stated on, the flag the platform DNS answers under (ADR 0132). */
export function withPlatformDnsOn(repository: Repository): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...repository.environment.features, "platform-dns": true },
    },
  };
}

/** The local repository with the gateway and traffic flags pinned off. */
export async function loadLocalGatewayFlagsOff(): Promise<Repository> {
  return withGatewayFlagsOff(await loadRepository("local"));
}
