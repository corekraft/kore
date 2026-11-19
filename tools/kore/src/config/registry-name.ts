import { featureEnabled, registryByNameFlag } from "./features.js";
import { platformPlan } from "./platform-domain.js";
import type { Environment } from "./types.js";

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md

/**
 * The registry's name under the platform organization,
 * `registry.<organizationId>.<domain>`: the one derivation, from the
 * environment's platform field, that host-side callers dial and the registry
 * chart's certificate and route carry.
 */
export function registryHostname(environment: Environment): string {
  const { domain, organizationId } = platformPlan(environment);
  return `registry.${organizationId}.${domain}`;
}

/** Whether host-side callers reach the registry by name instead of the port-forward. */
export function registryByName(environment: Environment): boolean {
  return featureEnabled(environment, registryByNameFlag);
}

/**
 * With registry-by-name on, the values the registry chart takes for its name
 * and the shared Gateway its passthrough route attaches to; otherwise none, so
 * the flag off renders what it rendered before.
 */
export function registryRouteHelmArgs(
  environment: Environment,
  component?: string,
): string[] {
  if (component !== "oci-registry" || !registryByName(environment)) {
    return [];
  }
  return [
    "--set-string",
    `registryRoute.hostname=${registryHostname(environment)}`,
    "--set-string",
    `registryRoute.gateway.name=${environment.gateway.name}`,
    "--set-string",
    `registryRoute.gateway.namespace=${environment.gateway.namespace}`,
  ];
}
