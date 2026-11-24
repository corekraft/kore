// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { featureEnabled } from "./features.js";
import { flagDependencyErrors } from "./flag-dependencies.js";
import { isLocalProvider } from "./provider.js";

vi.mock("./provider.js", () => ({ isLocalProvider: vi.fn() }));
vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  acmeDns01Flag: "acme-dns01",
  acmeIssuersFlag: "acme-issuers",
  externalGatewayFlag: "external-gateway",
  externalDnsFlag: "external-dns",
  externalGatewayLimitsFlag: "external-gateway-limits",
  inClusterCaFlag: "in-cluster-ca",
  otlpRouteFlag: "otlp-route",
  registryByNameFlag: "registry-by-name",
  platformSharedGatewayFlag: "platform-shared-gateway",
  serviceListenerSetsFlag: "service-listener-sets",
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

test("external-gateway on with service-listener-sets off is refused, naming both flags and the fix", () => {
  flagsOn(
    "external-gateway",
    "platform-shared-gateway",
    "acme-issuers",
    "acme-dns01",
  );
  expect(flagDependencyErrors(environment)).toEqual([
    'environment local turns on external-gateway, which needs service-listener-sets: the external Gateway admits ListenerSets only from the namespaces the platform labels as shared; set "service-listener-sets": true in the local environment overlay, or turn external-gateway off',
  ]);
});

test("external-gateway on with service-listener-sets on has no error", () => {
  flagsOn(
    "external-gateway",
    "service-listener-sets",
    "platform-shared-gateway",
    "acme-issuers",
    "acme-dns01",
  );
  expect(flagDependencyErrors(environment)).toEqual([]);
});

test("external-gateway on without acme-issuers is refused, naming both flags and the fix", () => {
  flagsOn(
    "external-gateway",
    "service-listener-sets",
    "platform-shared-gateway",
  );
  expect(flagDependencyErrors(environment)).toEqual([
    'environment local turns on external-gateway, which needs acme-issuers: the external Gateway answers the HTTP-01 challenges of its names, and only the acme-issuers solver takes them there (ADR 0157); set "acme-issuers": true in the local environment overlay, or turn external-gateway off',
  ]);
});

test("acme-issuers on without acme-dns01 is refused, naming both flags and the fix, because the two issuers are the ones acme-dns01 renders", () => {
  flagsOn("acme-issuers");
  expect(flagDependencyErrors(environment)).toEqual([
    'environment local turns on acme-issuers, which needs acme-dns01: the issuers acme-issuers adds its HTTP-01 solver to are the ones acme-dns01 renders, so there are none without it; set "acme-dns01": true in the local environment overlay, or turn acme-issuers off',
  ]);
});

test("acme-issuers on with acme-dns01 on has no error", () => {
  flagsOn("acme-issuers", "acme-dns01");
  expect(flagDependencyErrors(environment)).toEqual([]);
});

test("acme-issuers off needs nothing, and external-gateway with acme-issuers on needs nothing more than its own chain", () => {
  flagsOn();
  expect(flagDependencyErrors(environment)).toEqual([]);
  flagsOn(
    "external-gateway",
    "service-listener-sets",
    "platform-shared-gateway",
    "acme-issuers",
    "acme-dns01",
  );
  expect(flagDependencyErrors(environment)).toEqual([]);
});

test("external-gateway-limits on with external-gateway off is refused, naming both flags and the fix", () => {
  flagsOn(
    "external-gateway-limits",
    "service-listener-sets",
    "platform-shared-gateway",
  );
  expect(flagDependencyErrors(environment)).toEqual([
    'environment local turns on external-gateway-limits, which needs external-gateway: the limits are the external Gateway\'s policy, so there is no Gateway to limit without it; set "external-gateway": true in the local environment overlay, or turn external-gateway-limits off',
  ]);
});

test("external-gateway-limits on with external-gateway on has no error", () => {
  flagsOn(
    "external-gateway-limits",
    "external-gateway",
    "service-listener-sets",
    "platform-shared-gateway",
    "acme-issuers",
    "acme-dns01",
  );
  expect(flagDependencyErrors(environment)).toEqual([]);
});

test("external-dns on with external-gateway off is refused, naming both flags and the fix", () => {
  flagsOn("external-dns", "service-listener-sets", "platform-shared-gateway");
  expect(flagDependencyErrors(environment)).toEqual([
    'environment local turns on external-dns, which needs external-gateway: external-dns publishes the records of the external Gateway\'s routes, so it has no records to publish without it; set "external-gateway": true in the local environment overlay, or turn external-dns off',
  ]);
});

test("external-dns on with external-gateway on has no error", () => {
  flagsOn(
    "external-dns",
    "external-gateway",
    "service-listener-sets",
    "platform-shared-gateway",
    "acme-issuers",
    "acme-dns01",
  );
  expect(flagDependencyErrors(environment)).toEqual([]);
});

test("service-listener-sets on with platform-shared-gateway off is refused, naming both flags and the fix", () => {
  flagsOn("service-listener-sets");
  expect(flagDependencyErrors(environment)).toEqual([
    'environment local turns on service-listener-sets, which needs platform-shared-gateway: the Gateways admit ListenerSets only from the namespaces the shared-Gateway label marks, which only platform-shared-gateway sets; set "platform-shared-gateway": true in the local environment overlay, or turn service-listener-sets off',
  ]);
});

test("service-listener-sets on with platform-shared-gateway on has no error", () => {
  flagsOn("service-listener-sets", "platform-shared-gateway");
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

test("acme-dns01 on for a k3d environment is refused, because a k3d zone is not public and Let's Encrypt cannot check DNS-01 against it", () => {
  flagsOn("acme-dns01");
  vi.mocked(isLocalProvider).mockReturnValue(true);
  expect(flagDependencyErrors(environment)).toEqual([
    "environment local turns on acme-dns01, which needs a real zone: a k3d environment has no public zone for Let's Encrypt to check DNS-01 against; turn acme-dns01 off in the local environment overlay",
  ]);
});

test("acme-dns01 on for a managed environment has no error", () => {
  flagsOn("acme-dns01");
  expect(flagDependencyErrors(environment)).toEqual([]);
});

test("acme-dns01 off needs nothing, even for a k3d environment", () => {
  flagsOn();
  vi.mocked(isLocalProvider).mockReturnValue(true);
  expect(flagDependencyErrors(environment)).toEqual([]);
});
