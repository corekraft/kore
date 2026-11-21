// Docs: docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md
import { beforeEach, expect, test, vi } from "vitest";
import { featureHelmArgs } from "../config/index.js";
import { helmUpgradeArgs } from "./helm.js";
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

beforeEach(() => {
  configAnswers();
  vi.mocked(featureHelmArgs).mockReturnValue([
    "--set",
    "features.platform-portal=true",
  ]);
});

const localChart = (name: string) => {
  const { repository: _repository, ...component } = fakeComponent({
    name,
    kind: "local-chart",
    chart: `infra/charts/${name}`,
  });
  return component;
};

test("the portal chart takes no feature flags, since its closed schema refuses a features key its templates never read", () => {
  expect(
    helmUpgradeArgs(fakeRepository(), localChart("kore-platform-backstage")),
  ).not.toContain("features.platform-portal=true");
});

test("another local chart still receives the feature flags, so only the portal is left out", () => {
  expect(
    helmUpgradeArgs(fakeRepository(), localChart("kore-platform-keycloak")),
  ).toContain("features.platform-portal=true");
});

test("the PostgreSQL API chart takes no feature flags: no argument starts with features, so its values schema is never refused", () => {
  const args = helmUpgradeArgs(
    fakeRepository(),
    localChart("kore-postgresql-api"),
  );
  expect(args.filter((arg) => arg.startsWith("features"))).toEqual([]);
});
