import { alertContactPoint } from "./alert-email.js";
import type { Environment } from "./types.js";

// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md

/** The ConfigMap the service-observability chart owns: one rule file for every Service. */
const serviceRulesName = "kore-service-rules";
const serviceRulesPath = "/etc/kore/service-rules";
/** The Grafana release's admin Secret, which Grafana's alert manager API authenticates against. */
const grafanaAdminSecret = "grafana";
const grafanaAdminName = "kore-grafana-admin";
const grafanaAdminPath = "/etc/kore/grafana-admin";

/**
 * The rule files the metrics store loads: the three its chart writes and the
 * platform file already in the overlay values, then the Service rules. A
 * --set-json replaces the whole list, so the first three repeat the values.
 */
const ruleFiles = [
  "/etc/config/recording_rules.yml",
  "/etc/config/alerting_rules.yml",
  "/etc/kore/rules/platform.yaml",
  `${serviceRulesPath}/*.yaml`,
];

const set = (key: string, value: unknown): string[] => [
  "--set-json",
  `${key}=${JSON.stringify(value)}`,
];

/**
 * Helm arguments that make the metrics store evaluate the Service alert rules
 * and forward what fires to Grafana. They exist only while platform-portal is
 * on and an alert address is set, so every other environment's release is as
 * it was. Both mounts are optional: the metrics store installs before Grafana
 * and the service-observability chart, so a required mount would never become
 * ready. The kubelet fills an optional mount once its object exists, and the
 * reload sidecar watches the rules directory so a new Service's rules load
 * without a restart. Grafana owns the contact point and the policy, so no
 * alert manager is added: fired alerts go to Grafana's own, authenticated with
 * the Grafana admin password read from a mounted Secret file, never an argument.
 */
export function alertForwardingHelmArgs(
  environment: Pick<Environment, "alertEmail" | "features">,
  component: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (
    component !== "prometheus" ||
    alertContactPoint(environment, env) === undefined
  ) {
    return [];
  }
  const rulesMount = {
    name: serviceRulesName,
    mountPath: serviceRulesPath,
    readOnly: true,
  };
  return [
    ...set("server.extraVolumes", [
      {
        name: serviceRulesName,
        configMap: { name: serviceRulesName, optional: true },
      },
      {
        name: grafanaAdminName,
        secret: { secretName: grafanaAdminSecret, optional: true },
      },
    ]),
    ...set("server.extraVolumeMounts", [
      rulesMount,
      { name: grafanaAdminName, mountPath: grafanaAdminPath, readOnly: true },
    ]),
    ...set("configmapReload.prometheus.extraVolumeMounts", [rulesMount]),
    ...set("configmapReload.prometheus.extraVolumeDirs", [serviceRulesPath]),
    ...set("serverFiles.prometheus\\.yml.rule_files", ruleFiles),
    ...set("server.alertmanagers", [
      {
        scheme: "http",
        path_prefix: "/api/alertmanager/grafana",
        basic_auth: {
          username: "admin",
          password_file: `${grafanaAdminPath}/admin-password`,
        },
        static_configs: [{ targets: ["grafana.observability.svc:80"] }],
      },
    ]),
  ];
}
