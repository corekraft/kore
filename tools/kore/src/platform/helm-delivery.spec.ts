import { beforeEach, expect, test, vi } from "vitest";
import { assertChartDelivery, helmUpgradeArgs } from "./helm.js";
import { configAnswers } from "./helm-support.js";
import { fakeComponent, fakeRepository } from "./platform-support.js";

vi.mock("../config/index.js", () => ({
  absolute: vi.fn(),
  componentValues: vi.fn(),
  componentVersion: vi.fn(),
  expandVersions: vi.fn(),
  featureHelmArgs: vi.fn(),
  gatewayClassName: vi.fn(),
  noMatchPolicy: vi.fn(),
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
};

test("kore-config-delivery is given the composed chart values as JSON, so no lock or catalog is read at install", () => {
  const args = helmUpgradeArgs(
    { ...repository, chartDelivery: delivery },
    fakeComponent({ name: "kore-config-delivery" }),
  );
  expect(args.slice(-6)).toEqual([
    "--set-json",
    `charts=${JSON.stringify(delivery.charts)}`,
    "--set-json",
    `namespaces=${JSON.stringify(delivery.namespaces)}`,
    "--set-string",
    "gatewayClassName=istio",
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
    "kore-config-delivery needs the chart lock: run `kore platform up --platform-chart-lock <platform-charts.lock.json>`, the release asset published with the charts (kore local up does not pass it yet)",
  );
});

test("composed values, or any other component, pass the delivery check", () => {
  const composed = { ...repository, chartDelivery: delivery };
  const release = fakeComponent({ name: "kore-config-delivery" });
  expect(() => assertChartDelivery(composed, release)).not.toThrow();
  expect(() => assertChartDelivery(repository, fakeComponent())).not.toThrow();
});
