// Docs: docs/decisions/0177-service-alert-rules-are-grafana-managed-rules-over-the-prometheus-datasource.md
import { expect, test, vi } from "vitest";
import { alertContactPoint } from "./alert-email.js";
import { alertForwardingHelmArgs } from "./alert-forwarding.js";
import { fakeEnvironment } from "./config-support.js";

vi.mock("./alert-email.js", () => ({ alertContactPoint: vi.fn() }));

const environment = fakeEnvironment();
const operatorEnv: NodeJS.ProcessEnv = {};

const grafanaAlertSidecar = JSON.stringify({
  enabled: true,
  label: "grafana_alert",
  labelValue: "1",
  resource: "configmap",
  searchNamespace: "observability",
  folder: "/etc/grafana/provisioning/alerting",
  reloadURL: "http://localhost:3000/api/admin/provisioning/alerting/reload",
});

test("with no contact point (the portal off, or no address set) Grafana gets no alerting sidecar, so its release is as before", () => {
  vi.mocked(alertContactPoint).mockReturnValue(undefined);
  expect(alertForwardingHelmArgs(environment, "grafana", operatorEnv)).toEqual(
    [],
  );
  expect(alertContactPoint).toHaveBeenCalledWith(environment, operatorEnv);
});

test("with a contact point Grafana loads the Service alert rules from the ConfigMaps labelled grafana_alert=1 in observability", () => {
  vi.mocked(alertContactPoint).mockReturnValue("kore-platform-email");
  expect(alertForwardingHelmArgs(environment, "grafana", operatorEnv)).toEqual([
    "--set-json",
    `sidecar.alerts=${grafanaAlertSidecar}`,
  ]);
});

test("with a contact point the metrics store gets no argument: it keeps the platform rule file, lists no Alertmanager and mounts no Grafana credential", () => {
  vi.mocked(alertContactPoint).mockReturnValue("kore-platform-email");
  for (const component of [
    "prometheus",
    "kore-service-observability",
    "loki",
  ]) {
    expect(
      alertForwardingHelmArgs(environment, component, operatorEnv),
    ).toEqual([]);
  }
});

test("the arguments name no credential and no address", () => {
  vi.mocked(alertContactPoint).mockReturnValue("kore-platform-email");
  const text = alertForwardingHelmArgs(
    environment,
    "grafana",
    operatorEnv,
  ).join(" ");
  expect(text).not.toMatch(/@/);
  expect(text).not.toContain("password");
});
