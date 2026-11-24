import { acmeDns01Flag, featureEnabled, inClusterCaFlag } from "./features.js";
import { isLocalProvider } from "./provider.js";
import type { Environment } from "./types.js";

// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md

/**
 * Errors of a flag turned on for a provider that cannot run it, found before
 * any mutation. These are provider facts, not `requires` edges between flags,
 * so the flag manifest does not carry them: a k3d environment's CA comes from
 * `kore trust install`, so in-cluster-ca would give one ClusterIssuer two
 * owners, and a k3d environment has no public zone for acme-dns01.
 */
export function providerFlagErrors(environment: Environment): string[] {
  if (!isLocalProvider(environment)) {
    return [];
  }
  const twoCaOwners = featureEnabled(environment, inClusterCaFlag)
    ? [
        `environment ${environment.name} turns on ${inClusterCaFlag}, which creates the cluster's own root CA, but a k3d environment's CA comes from kore trust install and the two would own one ClusterIssuer; turn ${inClusterCaFlag} off in the ${environment.name} environment overlay`,
      ]
    : [];
  const acmeNeedsZone = featureEnabled(environment, acmeDns01Flag)
    ? [
        `environment ${environment.name} turns on ${acmeDns01Flag}, which needs a real zone: a k3d environment has no public zone for Let's Encrypt to check DNS-01 against; turn ${acmeDns01Flag} off in the ${environment.name} environment overlay`,
      ]
    : [];
  return [...twoCaOwners, ...acmeNeedsZone];
}
