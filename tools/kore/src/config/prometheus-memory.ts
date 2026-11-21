import { featureEnabled, platformPortalFlag } from "./features.js";
import type { Environment } from "./types.js";

// Docs: infra/plans/15-next-horizon.md (issue #1705: prometheus-server is OOMKilled at its 1Gi limit with platform-portal installed)

/** The memory the Prometheus server takes, as its request and its limit, while platform-portal is on. */
const portalPrometheusMemory = "2Gi";

/**
 * Helm arguments that raise the Prometheus server's memory request and limit
 * under platform-portal, where the portal's dashboards, rules and series take
 * more than the overlay's 1Gi limit (OOMKilled at 12 restarts, issue #1705).
 * With the flag off Prometheus gets no argument, so its release keeps the
 * overlay's values as they were; the overlay itself is unchanged.
 */
export function prometheusPortalHelmArgs(
  environment: Pick<Environment, "features">,
  component: string,
): string[] {
  if (
    component !== "prometheus" ||
    !featureEnabled(environment, platformPortalFlag)
  ) {
    return [];
  }
  return [
    "--set",
    `server.resources.requests.memory=${portalPrometheusMemory}`,
    "--set",
    `server.resources.limits.memory=${portalPrometheusMemory}`,
  ];
}
