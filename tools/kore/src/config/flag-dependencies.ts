import {
  featureEnabled,
  otlpRouteFlag,
  platformSharedGatewayFlag,
  registryByNameFlag,
} from "./features.js";
import type { Environment } from "./types.js";

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md

/** What each flag served through the shared Gateway, for the refusal's message. */
const sharedGatewayReasons: Record<string, string> = {
  [registryByNameFlag]:
    "its passthrough listener and the registry's name are served only through the shared Gateway",
  [otlpRouteFlag]: "its route is served only through the shared Gateway",
};

/**
 * Errors of a flag turned on without a flag it needs, found before any
 * mutation: registry-by-name and otlp-route serve a name through the shared
 * Gateway, so each needs platform-shared-gateway (ADR 0132, ADR 0140).
 */
export function flagDependencyErrors(environment: Environment): string[] {
  return Object.keys(sharedGatewayReasons).flatMap((flag) =>
    featureEnabled(environment, flag) &&
    !featureEnabled(environment, platformSharedGatewayFlag)
      ? [
          `environment ${environment.name} turns on ${flag}, which needs ${platformSharedGatewayFlag}: ${sharedGatewayReasons[flag]}; set "${platformSharedGatewayFlag}": true in the ${environment.name} environment overlay, or turn ${flag} off`,
        ]
      : [],
  );
}
