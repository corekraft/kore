// Docs: infra/plans/15-next-horizon.md (issue #1705: prometheus-server is OOMKilled at its 1Gi limit with platform-portal installed)
import { expect, test, vi } from "vitest";
import { prometheusPortalHelmArgs } from "./prometheus-memory.js";
import { fakeEnvironment } from "./config-support.js";
import { featureEnabled } from "./features.js";

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  platformPortalFlag: "platform-portal",
}));

const environment = fakeEnvironment();

test("with platform-portal off Prometheus gets no argument, so its release keeps the overlay's memory", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(prometheusPortalHelmArgs(environment, "prometheus")).toEqual([]);
  expect(featureEnabled).toHaveBeenCalledWith(environment, "platform-portal");
});

test("with platform-portal on Prometheus gets a 2Gi memory request and limit, so the portal footprint fits", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  expect(prometheusPortalHelmArgs(environment, "prometheus")).toEqual([
    "--set",
    "server.resources.requests.memory=2Gi",
    "--set",
    "server.resources.limits.memory=2Gi",
  ]);
});

test("with platform-portal on no other component's memory is changed", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  expect(prometheusPortalHelmArgs(environment, "grafana")).toEqual([]);
  expect(prometheusPortalHelmArgs(environment, "loki")).toEqual([]);
});
