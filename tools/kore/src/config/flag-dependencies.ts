import {
  featureEnabled,
  platformSharedGatewayFlag,
  registryByNameFlag,
} from "./features.js";
import type { Environment } from "./types.js";

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md

/**
 * Errors of a flag turned on without a flag it needs, found before any
 * mutation: registry-by-name serves the registry's name through the shared
 * Gateway, so it needs platform-shared-gateway.
 */
export function flagDependencyErrors(environment: Environment): string[] {
  return featureEnabled(environment, registryByNameFlag) &&
    !featureEnabled(environment, platformSharedGatewayFlag)
    ? [
        `environment ${environment.name} turns on ${registryByNameFlag}, which needs ${platformSharedGatewayFlag}: its passthrough listener and the registry's name are served only through the shared Gateway; set "${platformSharedGatewayFlag}": true in the ${environment.name} environment overlay, or turn ${registryByNameFlag} off`,
      ]
    : [];
}
