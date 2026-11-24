import {
  acmeDns01Flag,
  externalDnsFlag,
  externalGatewayFlag,
  externalGatewayLimitsFlag,
  featureEnabled,
  inClusterCaFlag,
  otlpRouteFlag,
  platformSharedGatewayFlag,
  registryByNameFlag,
  serviceListenerSetsFlag,
} from "./features.js";
import { isLocalProvider } from "./provider.js";
import type { Environment } from "./types.js";

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md
// Docs: docs/decisions/0160-vps-has-an-internal-gateway-on-the-tailnet-and-an-external-gateway-on-public-443.md

/** A flag that is refused on without the flag it needs, and why it needs it. */
interface Requirement {
  flag: string;
  needs: string;
  reason: string;
}

/** The requirements between flags. Each is checked on its own, so a chain reports every broken link. */
const requirements: Requirement[] = [
  {
    flag: registryByNameFlag,
    needs: platformSharedGatewayFlag,
    reason:
      "its passthrough listener and the registry's name are served only through the shared Gateway",
  },
  {
    flag: otlpRouteFlag,
    needs: platformSharedGatewayFlag,
    reason: "its route is served only through the shared Gateway",
  },
  {
    flag: serviceListenerSetsFlag,
    needs: platformSharedGatewayFlag,
    reason:
      "the Gateways admit ListenerSets only from the namespaces the shared-Gateway label marks, which only platform-shared-gateway sets",
  },
  {
    flag: externalGatewayFlag,
    needs: serviceListenerSetsFlag,
    reason:
      "the external Gateway admits ListenerSets only from the namespaces the platform labels as shared",
  },
  {
    flag: externalGatewayLimitsFlag,
    needs: externalGatewayFlag,
    reason:
      "the limits are the external Gateway's policy, so there is no Gateway to limit without it",
  },
  {
    flag: externalDnsFlag,
    needs: externalGatewayFlag,
    reason:
      "external-dns publishes the records of the external Gateway's routes, so it has no records to publish without it",
  },
];

/**
 * Errors of a flag turned on without a flag it needs, found before any
 * mutation: registry-by-name and otlp-route serve a name through the shared
 * Gateway (ADR 0132, ADR 0140), service-listener-sets admits ListenerSets only
 * from the shared-Gateway namespaces (ADR 0159), and the external Gateway needs
 * service-listener-sets (ADR 0160).
 */
export function flagDependencyErrors(environment: Environment): string[] {
  const needed = requirements.flatMap(({ flag, needs, reason }) =>
    featureEnabled(environment, flag) && !featureEnabled(environment, needs)
      ? [
          `environment ${environment.name} turns on ${flag}, which needs ${needs}: ${reason}; set "${needs}": true in the ${environment.name} environment overlay, or turn ${flag} off`,
        ]
      : [],
  );
  const twoCaOwners =
    featureEnabled(environment, inClusterCaFlag) && isLocalProvider(environment)
      ? [
          `environment ${environment.name} turns on ${inClusterCaFlag}, which creates the cluster's own root CA, but a k3d environment's CA comes from kore trust install and the two would own one ClusterIssuer; turn ${inClusterCaFlag} off in the ${environment.name} environment overlay`,
        ]
      : [];
  const acmeNeedsZone =
    featureEnabled(environment, acmeDns01Flag) && isLocalProvider(environment)
      ? [
          `environment ${environment.name} turns on ${acmeDns01Flag}, which needs a real zone: a k3d environment has no public zone for Let's Encrypt to check DNS-01 against; turn ${acmeDns01Flag} off in the ${environment.name} environment overlay`,
        ]
      : [];
  return [...needed, ...twoCaOwners, ...acmeNeedsZone];
}
