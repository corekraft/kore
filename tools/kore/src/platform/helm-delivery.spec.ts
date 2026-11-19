import { beforeEach, expect, test, vi } from "vitest";
import {
  alertEmailHelmArgs,
  alertForwardingHelmArgs,
  componentValues,
  dashboardSidecarHelmArgs,
  featureHelmArgs,
  platformHelmArgs,
  registeredServiceHelmArgs,
} from "../config/index.js";
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
  alertForwardingHelmArgs: vi.fn(),
  componentValues: vi.fn(),
  componentVersion: vi.fn(),
  dashboardSidecarHelmArgs: vi.fn(),
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
  platformDomain: "kore.local",
};

test("kore-config-delivery is given the composed chart values as JSON, so no lock or catalog is read at install", () => {
  const args = helmUpgradeArgs(
    { ...repository, chartDelivery: delivery },
    fakeComponent({ name: "kore-config-delivery" }),
  );
  expect(args.slice(-8)).toEqual([
    "--set-json",
    `charts=${JSON.stringify(delivery.charts)}`,
    "--set-json",
    `namespaces=${JSON.stringify(delivery.namespaces)}`,
    "--set-string",
    "gatewayClassName=istio",
    "--set-string",
    "platformDomain=kore.local",
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
  expect(args.slice(-10)).toEqual([
    "--set-json",
    `charts=${JSON.stringify(delivery.charts)}`,
    "--set-json",
    `namespaces=${JSON.stringify(delivery.namespaces)}`,
    "--set-string",
    "gatewayClassName=istio",
    "--set-string",
    "platformDomain=kore.local",
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

test("the delivery charts take no feature flags, since their closed schemas refuse a features key their templates never read", () => {
  vi.mocked(featureHelmArgs).mockReturnValue([
    "--set",
    "features.platform-argocd-delivery=true",
  ]);
  for (const name of ["kore-config-delivery", "kore-golden-path-delivery"]) {
    const { repository: _repository, ...release } = fakeComponent({
      name,
      kind: "local-chart",
      chart: `infra/charts/${name}`,
    });
    const args = helmUpgradeArgs(
      { ...repository, chartDelivery: delivery, goldenPathDelivery: golden },
      release,
    );
    expect(args, name).not.toContain("features.platform-argocd-delivery=true");
  }
});

test("a local chart that reads feature flags still receives them", () => {
  vi.mocked(featureHelmArgs).mockReturnValue([
    "--set",
    "features.platform-argocd-delivery=true",
  ]);
  const { repository: _repository, ...local } = fakeComponent({
    name: "platform-config",
    kind: "local-chart",
    chart: "infra/charts/platform-config",
  });
  expect(helmUpgradeArgs(repository, local)).toContain(
    "features.platform-argocd-delivery=true",
  );
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

test("a component's registered Service names come from the config domain, given the repository's derived list", () => {
  vi.mocked(registeredServiceHelmArgs).mockReturnValue([
    "--set-json",
    'services=["shop"]',
  ]);
  const args = helmUpgradeArgs(
    { ...repository, registeredServices: ["shop"] },
    fakeComponent({ name: "kore-service-observability" }),
  );
  expect(args.slice(-2)).toEqual(["--set-json", 'services=["shop"]']);
  expect(registeredServiceHelmArgs).toHaveBeenCalledWith(
    repository.environment,
    "kore-service-observability",
    ["shop"],
  );
});

test("a repository without a derived list hands the config domain an empty list, never an undefined one", () => {
  helmUpgradeArgs(repository, fakeComponent({ name: "grafana" }));
  expect(registeredServiceHelmArgs).toHaveBeenCalledWith(
    repository.environment,
    "grafana",
    [],
  );
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

test("Grafana's dashboard sidecar arguments come from the config domain with the component's name, after the other values", () => {
  vi.mocked(dashboardSidecarHelmArgs).mockReturnValue([
    "--set-json",
    "rbac.namespaced=true",
  ]);
  const args = helmUpgradeArgs(repository, fakeComponent({ name: "grafana" }));
  expect(args.slice(-2)).toEqual(["--set-json", "rbac.namespaced=true"]);
  expect(dashboardSidecarHelmArgs).toHaveBeenCalledWith(
    repository.environment,
    "grafana",
  );
});

test("the metrics store's alert forwarding arguments come from the config domain with the component's name, after the other values", () => {
  vi.mocked(alertForwardingHelmArgs).mockReturnValue([
    "--set-json",
    "server.alertmanagers=[]",
  ]);
  const args = helmUpgradeArgs(
    repository,
    fakeComponent({ name: "prometheus" }),
  );
  expect(args.slice(-2)).toEqual(["--set-json", "server.alertmanagers=[]"]);
  expect(alertForwardingHelmArgs).toHaveBeenCalledWith(
    repository.environment,
    "prometheus",
  );
});

test("a component that names the platform domain is handed the environment's value after its values files, so no hand-set copy can win", () => {
  vi.mocked(componentValues).mockReturnValue(["infra/values/a.yaml"]);
  vi.mocked(platformHelmArgs).mockReturnValue([
    "--set-string",
    "platformDomain=kore.local",
  ]);
  const args = helmUpgradeArgs(
    repository,
    fakeComponent({ name: "kore-platform-apis" }),
  );
  expect(args.indexOf("platformDomain=kore.local")).toBeGreaterThan(
    args.indexOf("/repo/infra/values/a.yaml"),
  );
  expect(platformHelmArgs).toHaveBeenCalledWith(
    repository.environment,
    "kore-platform-apis",
  );
});
