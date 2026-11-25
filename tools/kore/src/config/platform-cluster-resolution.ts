// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { internalGateway } from "./gateways.js";
import {
  featureEnabled,
  platformDnsFlag,
  suborgNetworkPolicyFlag,
  suborgTenancyFlag,
} from "./features.js";
import type { Environment } from "./types.js";

/** The ConfigMap, in the portal's namespace, that carries the local CA its pods trust (ADR 0132). */
export const localCaConfigMap = "kore-local-ca";

/**
 * With platform-dns on, the arguments the platform-dns and portal charts take
 * for in-cluster name resolution: the Gateway whose Service the zone rewrites
 * to, and the CA bundle the portal's pods trust. Off, none.
 */
export function clusterResolutionArgs(
  environment: Environment,
  component: string,
): string[] {
  if (!featureEnabled(environment, platformDnsFlag)) {
    return [];
  }
  if (component === "kore-platform-backstage") {
    return ["--set-string", `localCa.configMap=${localCaConfigMap}`];
  }
  if (component === "kore-platform-dns") {
    const { name, namespace } = internalGateway(environment);
    return [
      "--set-string",
      `gateway.name=${name}`,
      "--set-string",
      `gateway.namespace=${namespace}`,
    ];
  }
  return [];
}

/**
 * With suborg-tenancy and suborg-network-policy on (ADR 0165, issue 1552), the cluster's
 * service range, which the suborg NetworkPolicies exclude from open egress: the k3d
 * cluster's range on k3d, the overlay's otherwise. Absent, none is passed and the chart
 * refuses to render the policies. Otherwise none is passed, so suborg-tenancy alone renders
 * what it rendered before.
 */
export function suborgNetworkArgs(
  environment: Environment,
  component: string,
): string[] {
  const serviceCidr = suborgServiceCidr(environment);
  const on = component === "kore-platform-apis" && suborgNetworkOn(environment);
  return on && serviceCidr !== undefined
    ? ["--set-string", `suborgNetwork.serviceCidr=${serviceCidr}`]
    : [];
}

/**
 * With suborg-tenancy and suborg-network-policy both on, the errors of an overlay that
 * records no service range (ADR 0165, issue 1552). The chart cannot render the suborg
 * policies without one, so validation refuses it before any cluster is touched; the field
 * named is the one the overlay sets for its provider. Otherwise none.
 */
export function suborgServiceRangeErrors(environment: Environment): string[] {
  if (
    !suborgNetworkOn(environment) ||
    suborgServiceCidr(environment) !== undefined
  ) {
    return [];
  }
  const field =
    environment.provider === "k3d" ? "k3d.serviceCidr" : "cluster.serviceCidr";
  return [
    `flags suborg-tenancy and suborg-network-policy are on in the ${environment.name} overlay but it records no ${field}, the cluster's service range; set ${field} in the ${environment.name} overlay, or turn suborg-network-policy off (ADR 0165)`,
  ];
}

/** Both suborg flags are on in the environment. */
function suborgNetworkOn(environment: Environment): boolean {
  return (
    featureEnabled(environment, suborgTenancyFlag) &&
    featureEnabled(environment, suborgNetworkPolicyFlag)
  );
}

/** The service range the environment's cluster records: the k3d cluster's on k3d, the cluster block's otherwise. */
function suborgServiceCidr(environment: Environment): string | undefined {
  const cluster =
    environment.provider === "k3d" ? environment.k3d : environment.cluster;
  return cluster?.serviceCidr;
}
