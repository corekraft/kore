import { beforeEach, expect, test, vi } from "vitest";
import { assertChartDelivery, helmUpgradeArgs } from "./helm.js";
import { configAnswers } from "./helm-support.js";
import { fakeComponent, fakeRepository } from "./platform-support.js";

vi.mock("../config/index.js", () => ({
  absolute: vi.fn(),
  alertEmailHelmArgs: vi.fn(),
  alertForwardingHelmArgs: vi.fn(),
  componentValues: vi.fn(),
  componentVersion: vi.fn(),
  dashboardSidecarHelmArgs: vi.fn(),
  prometheusPortalHelmArgs: vi.fn(),
  databaseRoutesDeliveryArgs: vi.fn(() => []),
  expandVersions: vi.fn(),
  featureHelmArgs: vi.fn(),
  gatewayClassName: vi.fn(),
  noMatchPolicy: vi.fn(),
  platformHelmArgs: vi.fn(),
  registeredServiceHelmArgs: vi.fn(),
  registryConsumers: ["oci-registry", "kore-image-policy"],
  registryHelmArgs: vi.fn(),
}));
vi.mock("./patches.js");

const repository = fakeRepository();

beforeEach(configAnswers);

const delivery = {
  charts: {
    "kore-local-tls": {
      chart: "reg/charts/kore-local-tls",
      digest: "sha256:1",
    },
  },
  namespaces: { "kore-local-tls": "cert" },
  gatewayClassName: "istio",
  platformDomain: "kore.internal",
  platformHostname: "*.platform.kore.internal",
};

test("kore-config-delivery is given the composed chart values as JSON, so no lock or catalog is read at install", () => {
  const args = helmUpgradeArgs(
    { ...repository, chartDelivery: delivery },
    fakeComponent({ name: "kore-config-delivery" }),
  );
  expect(args.slice(-10)).toEqual([
    "--set-json",
    `charts=${JSON.stringify(delivery.charts)}`,
    "--set-json",
    `namespaces=${JSON.stringify(delivery.namespaces)}`,
    "--set-string",
    "gatewayClassName=istio",
    "--set-string",
    "platformDomain=kore.internal",
    "--set-string",
    "platformHostname=*.platform.kore.internal",
  ]);
});

test("kore-config-delivery is handed each release's values-file text as JSON, so the Applications carry the environment values the Helm path gives", () => {
  const releaseValues = {
    "kore-local-tls": ["gateway:\n  port: 8443\n"],
  };
  const args = helmUpgradeArgs(
    { ...repository, chartDelivery: { ...delivery, releaseValues } },
    fakeComponent({ name: "kore-config-delivery" }),
  );
  expect(args.slice(-12)).toEqual([
    "--set-json",
    `charts=${JSON.stringify(delivery.charts)}`,
    "--set-json",
    `namespaces=${JSON.stringify(delivery.namespaces)}`,
    "--set-string",
    "gatewayClassName=istio",
    "--set-string",
    "platformDomain=kore.internal",
    "--set-string",
    "platformHostname=*.platform.kore.internal",
    "--set-json",
    `releaseValues=${JSON.stringify(releaseValues)}`,
  ]);
});

test("no other component gets delivery values, and kore-config-delivery gets none before they are composed", () => {
  const withValues = { ...repository, chartDelivery: delivery };
  expect(helmUpgradeArgs(withValues, fakeComponent())).not.toContain(
    "--set-json",
  );
  expect(
    helmUpgradeArgs(
      repository,
      fakeComponent({ name: "kore-config-delivery" }),
    ),
  ).not.toContain("--set-json");
});

test("kore-config-delivery without composed values is refused with the flag to pass and where the lock comes from", () => {
  expect(() =>
    assertChartDelivery(
      repository,
      fakeComponent({ name: "kore-config-delivery" }),
    ),
  ).toThrow(
    "kore-config-delivery needs the chart lock: run `kore platform up --platform-chart-lock <platform-charts.lock.json>`, the release asset published with the charts (`kore local up` takes the same flag)",
  );
});

test("composed values, or any other component, pass the delivery check", () => {
  const composed = { ...repository, chartDelivery: delivery };
  const release = fakeComponent({ name: "kore-config-delivery" });
  expect(() => assertChartDelivery(composed, release)).not.toThrow();
  expect(() => assertChartDelivery(repository, fakeComponent())).not.toThrow();
});
