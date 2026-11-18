import { featureEnabled, platformPortalFlag } from "./features.js";
import type { Environment } from "./types.js";

// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md

/** The label the service-observability chart puts on each Service's dashboard ConfigMap. */
const dashboardLabel = "grafana_dashboard";
const dashboardLabelValue = "1";
/** Where the service-observability release, and so every dashboard ConfigMap, lives. */
const dashboardNamespace = "observability";

/**
 * Helm arguments that make Grafana load the default Service dashboards. Under
 * platform-portal the Grafana release gains Grafana's dashboard sidecar, which
 * reads only ConfigMaps (never Secrets) carrying the label, in the one
 * namespace that holds them, and reads them through a namespaced Role. With the
 * flag off Grafana gets no argument, so its release is as it was. The sidecar
 * image is pinned by digest in the grafana values, so it is never an argument.
 */
export function dashboardSidecarHelmArgs(
  environment: Pick<Environment, "features">,
  component: string,
): string[] {
  if (
    component !== "grafana" ||
    !featureEnabled(environment, platformPortalFlag)
  ) {
    return [];
  }
  return [
    "--set-json",
    `sidecar.dashboards=${JSON.stringify({
      enabled: true,
      label: dashboardLabel,
      labelValue: dashboardLabelValue,
      resource: "configmap",
      searchNamespace: dashboardNamespace,
    })}`,
    "--set-json",
    "rbac.namespaced=true",
  ];
}
