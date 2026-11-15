import { beforeEach, expect, test, vi } from "vitest";
import { alertEmailHelmArgs } from "../config/index.js";
import {
  assertChartDelivery,
  assertGoldenPathDelivery,
  helmUpgradeArgs,
} from "./helm.js";
import { configAnswers } from "./helm-support.js";
import { fakeComponent, fakeRepository } from "./platform-support.js";

vi.mock("../config/index.js", () => ({
  absolute: vi.fn(),
  alertEmailHelmArgs: vi.fn(),
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
    "kore-config-delivery needs the chart lock: run `kore platform up --platform-chart-lock <platform-charts.lock.json>`, the release asset published with the charts (`kore local up` takes the same flag)",
  );
});

test("composed values, or any other component, pass the delivery check", () => {
  const composed = { ...repository, chartDelivery: delivery };
  const release = fakeComponent({ name: "kore-config-delivery" });
  expect(() => assertChartDelivery(composed, release)).not.toThrow();
  expect(() => assertChartDelivery(repository, fakeComponent())).not.toThrow();
});

const golden = {
  repoURL: "https://github.com/corekraft/kore.git",
  revision: "a".repeat(40),
  environment: "local",
  templateImages: {
    "static-frontend": {
      image: "ghcr.io/o/fe",
      digest: `sha256:${"1".repeat(64)}`,
    },
    "kotlin-bff": {
      image: "ghcr.io/o/bff",
      digest: `sha256:${"2".repeat(64)}`,
    },
  },
  ingress: { platformDomain: "kore.local", gatewayClassName: "istio" },
};

test("kore-golden-path-delivery is given the commit, the template digests and the ingress values, so the ApplicationSet deploys by digest and reaches HTTPS", () => {
  const args = helmUpgradeArgs(
    { ...repository, goldenPathDelivery: golden },
    fakeComponent({ name: "kore-golden-path-delivery" }),
  );
  expect(args.slice(-12)).toEqual([
    "--set-string",
    `repoURL=${golden.repoURL}`,
    "--set-string",
    `revision=${golden.revision}`,
    "--set-string",
    "environment=local",
    "--set-json",
    `templateImages=${JSON.stringify(golden.templateImages)}`,
    "--set-string",
    "ingress.platformDomain=kore.local",
    "--set-string",
    "ingress.gatewayClassName=istio",
  ]);
});

test("no other component gets the golden-path values", () => {
  expect(
    helmUpgradeArgs(
      { ...repository, goldenPathDelivery: golden },
      fakeComponent(),
    ),
  ).not.toContain(`revision=${golden.revision}`);
});

test("kore-golden-path-delivery without composed values is refused with the flag to pass", () => {
  expect(() =>
    assertGoldenPathDelivery(
      repository,
      fakeComponent({ name: "kore-golden-path-delivery" }),
    ),
  ).toThrow(
    "kore-golden-path-delivery needs the template lock: run `kore local up --platform-template-lock <template-images.lock.json>`, the release asset published with the template images",
  );
  expect(() =>
    assertGoldenPathDelivery(
      { ...repository, goldenPathDelivery: golden },
      fakeComponent({ name: "kore-golden-path-delivery" }),
    ),
  ).not.toThrow();
  expect(() =>
    assertGoldenPathDelivery(repository, fakeComponent()),
  ).not.toThrow();
});

test("a component's alert email arguments come from the config domain with the component's name, after the other values", () => {
  vi.mocked(alertEmailHelmArgs).mockReturnValue([
    "--set-string",
    "alerts.destination=kore-platform-email",
  ]);
  const args = helmUpgradeArgs(
    repository,
    fakeComponent({ name: "kore-service-observability" }),
  );
  expect(args.slice(-2)).toEqual([
    "--set-string",
    "alerts.destination=kore-platform-email",
  ]);
  expect(alertEmailHelmArgs).toHaveBeenCalledWith(
    repository.environment,
    "kore-service-observability",
  );
});
