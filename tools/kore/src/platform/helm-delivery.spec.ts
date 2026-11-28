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
import { assertGoldenPathDelivery, helmUpgradeArgs } from "./helm.js";
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
  keycloakOperatorProbeHelmArgs: vi.fn(),
  databaseRoutesDeliveryArgs: vi.fn(() => []),
  expandVersions: vi.fn(),
  featureHelmArgs: vi.fn(),
  gatewayClassName: vi.fn(),
  noMatchPolicy: vi.fn(),
  platformHelmArgs: vi.fn(),
  suborgDeliveryArgs: vi.fn(),
  applicationImageArgs: vi.fn(),
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
  ingress: { platformDomain: "kore.internal", gatewayClassName: "istio" },
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
    "ingress.platformDomain=kore.internal",
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
    "platformDomain=kore.internal",
  ]);
  const args = helmUpgradeArgs(
    repository,
    fakeComponent({ name: "kore-platform-apis" }),
  );
  expect(args.indexOf("platformDomain=kore.internal")).toBeGreaterThan(
    args.indexOf("/repo/infra/values/a.yaml"),
  );
  expect(platformHelmArgs).toHaveBeenCalledWith(
    repository.environment,
    "kore-platform-apis",
    process.env,
    [],
  );
});

test("the platform certificate is handed the suborg names of the Organization records, so a dropped name fails", () => {
  vi.mocked(componentValues).mockReturnValue([]);
  vi.mocked(platformHelmArgs).mockReturnValue([]);
  const withSuborgs = { ...repository, suborgs: ["reference"] };
  helmUpgradeArgs(withSuborgs, fakeComponent({ name: "kore-local-tls" }));
  expect(platformHelmArgs).toHaveBeenCalledWith(
    repository.environment,
    "kore-local-tls",
    process.env,
    ["reference"],
  );
});
