// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
import { expect, test, vi } from "vitest";
import { alertContactPoint } from "./alert-email.js";
import { alertForwardingHelmArgs } from "./alert-forwarding.js";
import { fakeEnvironment } from "./config-support.js";

vi.mock("./alert-email.js", () => ({ alertContactPoint: vi.fn() }));

const environment = fakeEnvironment();
const operatorEnv: NodeJS.ProcessEnv = {};

const volumes = JSON.stringify([
  {
    name: "kore-service-rules",
    configMap: { name: "kore-service-rules", optional: true },
  },
  {
    name: "kore-grafana-admin",
    secret: { secretName: "grafana", optional: true },
  },
]);
const mounts = JSON.stringify([
  {
    name: "kore-service-rules",
    mountPath: "/etc/kore/service-rules",
    readOnly: true,
  },
  {
    name: "kore-grafana-admin",
    mountPath: "/etc/kore/grafana-admin",
    readOnly: true,
  },
]);
const reloadMounts = JSON.stringify([
  {
    name: "kore-service-rules",
    mountPath: "/etc/kore/service-rules",
    readOnly: true,
  },
]);
const ruleFiles = JSON.stringify([
  "/etc/config/recording_rules.yml",
  "/etc/config/alerting_rules.yml",
  "/etc/kore/rules/platform.yaml",
  "/etc/kore/service-rules/*.yaml",
]);
const alertmanagers = JSON.stringify([
  {
    scheme: "http",
    path_prefix: "/api/alertmanager/grafana",
    basic_auth: {
      username: "admin",
      password_file: "/etc/kore/grafana-admin/admin-password",
    },
    static_configs: [{ targets: ["grafana.observability.svc:80"] }],
  },
]);

test("with no contact point (the portal off, or no address set) the metrics store gets no argument, so its release is as before", () => {
  vi.mocked(alertContactPoint).mockReturnValue(undefined);
  expect(
    alertForwardingHelmArgs(environment, "prometheus", operatorEnv),
  ).toEqual([]);
  expect(alertContactPoint).toHaveBeenCalledWith(environment, operatorEnv);
});

test("with a contact point the metrics store loads the Service rules, watches them for change and forwards fired alerts to Grafana's own alert manager", () => {
  vi.mocked(alertContactPoint).mockReturnValue("kore-platform-email");
  expect(
    alertForwardingHelmArgs(environment, "prometheus", operatorEnv),
  ).toEqual([
    "--set-json",
    `server.extraVolumes=${volumes}`,
    "--set-json",
    `server.extraVolumeMounts=${mounts}`,
    "--set-json",
    `configmapReload.prometheus.extraVolumeMounts=${reloadMounts}`,
    "--set-json",
    'configmapReload.prometheus.extraVolumeDirs=["/etc/kore/service-rules"]',
    "--set-json",
    `serverFiles.prometheus\\.yml.rule_files=${ruleFiles}`,
    "--set-json",
    `server.alertmanagers=${alertmanagers}`,
  ]);
});

test("with a contact point no other component gets a forwarding argument, so Grafana keeps the one contact point and the chart keeps the one rule file", () => {
  vi.mocked(alertContactPoint).mockReturnValue("kore-platform-email");
  for (const component of ["grafana", "kore-service-observability", "loki"]) {
    expect(
      alertForwardingHelmArgs(environment, component, operatorEnv),
    ).toEqual([]);
  }
});

test("the arguments name the Grafana admin Secret by reference and never carry a credential or an address", () => {
  vi.mocked(alertContactPoint).mockReturnValue("kore-platform-email");
  const text = alertForwardingHelmArgs(
    environment,
    "prometheus",
    operatorEnv,
  ).join(" ");
  expect(text).toContain("password_file");
  expect(text).not.toContain('"password"');
  expect(text).not.toMatch(/@/);
});
