// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
// Docs: docs/decisions/0177-service-alert-rules-are-grafana-managed-rules-over-the-prometheus-datasource.md
import { alertContactPoint } from "./alert-email.js";
import type { Environment } from "./types.js";

/** The label the service-observability chart puts on the Service alert ConfigMap. */
const alertLabel = "grafana_alert";
const alertLabelValue = "1";
/** Where the service-observability release, and so the alert ConfigMap, lives. */
const alertNamespace = "observability";
/** Where Grafana's alerting provisioning reads its files, and the endpoint that reloads them. */
const alertFolder = "/etc/grafana/provisioning/alerting";
const alertReloadUrl =
  "http://localhost:3000/api/admin/provisioning/alerting/reload";

/**
 * Helm arguments that make Grafana evaluate the Service alert rules. Grafana
 * owns them (ADR 0177): the service-observability chart renders them as
 * Grafana-managed rules over the Prometheus datasource, and Grafana's one root
 * policy routes what fires to the contact point. Under platform-portal with an
 * alert address set, the Grafana release gains Grafana's alerting sidecar,
 * which reads only the ConfigMaps labelled grafana_alert=1 in the one namespace
 * that holds them and reloads Grafana when they change. The metrics store gets
 * no argument: it keeps the platform rule file and holds no Grafana credential.
 * With the flag off or no address set, Grafana's release is as it was.
 */
export function alertForwardingHelmArgs(
  environment: Pick<Environment, "alertEmail" | "features">,
  component: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (
    component !== "grafana" ||
    alertContactPoint(environment, env) === undefined
  ) {
    return [];
  }
  return [
    "--set-json",
    `sidecar.alerts=${JSON.stringify({
      enabled: true,
      label: alertLabel,
      labelValue: alertLabelValue,
      resource: "configmap",
      searchNamespace: alertNamespace,
      folder: alertFolder,
      reloadURL: alertReloadUrl,
    })}`,
  ];
}
