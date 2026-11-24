// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { internalGateway } from "./gateways.js";
import {
  featureEnabled,
  platformDnsFlag,
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
 * With suborg-tenancy on (ADR 0165, issue 1552), the cluster's service range, which
 * the suborg NetworkPolicies exclude from open egress: the k3d cluster's range on k3d,
 * the overlay's otherwise. Absent, none is passed and the chart refuses to render.
 */
export function suborgNetworkArgs(
  environment: Environment,
  component: string,
): string[] {
  const cluster =
    environment.provider === "k3d" ? environment.k3d : environment.cluster;
  const on =
    component === "kore-platform-apis" &&
    featureEnabled(environment, suborgTenancyFlag);
  return on && cluster?.serviceCidr !== undefined
    ? ["--set-string", `suborgNetwork.serviceCidr=${cluster.serviceCidr}`]
    : [];
}
