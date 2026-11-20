// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { featureEnabled } from "./features.js";
import { flagDependencyErrors } from "./flag-dependencies.js";
import { isLocalProvider } from "./provider.js";

vi.mock("./provider.js", () => ({ isLocalProvider: vi.fn() }));
vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  inClusterCaFlag: "in-cluster-ca",
  otlpRouteFlag: "otlp-route",
  registryByNameFlag: "registry-by-name",
  platformSharedGatewayFlag: "platform-shared-gateway",
}));

const environment = fakeEnvironment({ name: "local" });

/** Which flags are on; every other flag is off. */
function flagsOn(...on: string[]): void {
  vi.mocked(featureEnabled).mockImplementation((_environment, flag) =>
    on.includes(flag),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isLocalProvider).mockReturnValue(false);
});

test("registry-by-name on with platform-shared-gateway off is refused, naming both flags and the fix", () => {
  flagsOn("registry-by-name");
  expect(flagDependencyErrors(environment)).toEqual([
    'environment local turns on registry-by-name, which needs platform-shared-gateway: its passthrough listener and the registry\'s name are served only through the shared Gateway; set "platform-shared-gateway": true in the local environment overlay, or turn registry-by-name off',
  ]);
});

test("registry-by-name on with platform-shared-gateway on has no error", () => {
  flagsOn("registry-by-name", "platform-shared-gateway");
  expect(flagDependencyErrors(environment)).toEqual([]);
});

test("otlp-route on with platform-shared-gateway off is refused, naming both flags and the fix", () => {
  flagsOn("otlp-route");
  expect(flagDependencyErrors(environment)).toEqual([
    'environment local turns on otlp-route, which needs platform-shared-gateway: its route is served only through the shared Gateway; set "platform-shared-gateway": true in the local environment overlay, or turn otlp-route off',
  ]);
});

test("otlp-route on with platform-shared-gateway on has no error", () => {
  flagsOn("otlp-route", "platform-shared-gateway");
  expect(flagDependencyErrors(environment)).toEqual([]);
});

test("otlp-route off needs nothing, whether or not the shared Gateway is on", () => {
  flagsOn();
  expect(flagDependencyErrors(environment)).toEqual([]);
  flagsOn("platform-shared-gateway");
  expect(flagDependencyErrors(environment)).toEqual([]);
});

test("registry-by-name off needs nothing, whether or not the shared Gateway is on", () => {
  flagsOn();
  expect(flagDependencyErrors(environment)).toEqual([]);
  flagsOn("platform-shared-gateway");
  expect(flagDependencyErrors(environment)).toEqual([]);
});

test("in-cluster-ca on for a k3d environment is refused, because kore trust install owns local's CA and a second owner would fight it", () => {
  flagsOn("in-cluster-ca");
  vi.mocked(isLocalProvider).mockReturnValue(true);
  expect(flagDependencyErrors(environment)).toEqual([
    "environment local turns on in-cluster-ca, which creates the cluster's own root CA, but a k3d environment's CA comes from kore trust install and the two would own one ClusterIssuer; turn in-cluster-ca off in the local environment overlay",
  ]);
});

test("in-cluster-ca on for a managed environment has no error", () => {
  flagsOn("in-cluster-ca");
  expect(flagDependencyErrors(environment)).toEqual([]);
});

test("in-cluster-ca off needs nothing, even for a k3d environment", () => {
  flagsOn();
  vi.mocked(isLocalProvider).mockReturnValue(true);
  expect(flagDependencyErrors(environment)).toEqual([]);
});
