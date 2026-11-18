// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
import { expect, test, vi } from "vitest";
import { dashboardSidecarHelmArgs } from "./dashboard-sidecar.js";
import { fakeEnvironment } from "./config-support.js";
import { featureEnabled } from "./features.js";

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  platformPortalFlag: "platform-portal",
}));

const environment = fakeEnvironment();

test("with platform-portal off Grafana gets no argument, so its release is as before", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(dashboardSidecarHelmArgs(environment, "grafana")).toEqual([]);
  expect(featureEnabled).toHaveBeenCalledWith(environment, "platform-portal");
});

test("with platform-portal on Grafana loads dashboards from the ConfigMaps labelled grafana_dashboard=1 in its own namespace, and nothing else", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  expect(dashboardSidecarHelmArgs(environment, "grafana")).toEqual([
    "--set-json",
    'sidecar.dashboards={"enabled":true,"label":"grafana_dashboard","labelValue":"1","resource":"configmap","searchNamespace":"observability"}',
    "--set-json",
    "rbac.namespaced=true",
  ]);
});

test("with platform-portal on no other component gets a dashboard sidecar", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  expect(dashboardSidecarHelmArgs(environment, "loki")).toEqual([]);
  expect(
    dashboardSidecarHelmArgs(environment, "kore-service-observability"),
  ).toEqual([]);
});
