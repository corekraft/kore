// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { beforeEach, expect, test, vi } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { featureEnabled } from "./features.js";
import { providerFlagErrors } from "./provider-flag-errors.js";
import { isLocalProvider } from "./provider.js";

vi.mock("./provider.js", () => ({ isLocalProvider: vi.fn() }));
vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  acmeDns01Flag: "acme-dns01",
  inClusterCaFlag: "in-cluster-ca",
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

test("in-cluster-ca on for a k3d environment is refused, because kore trust install owns local's CA and a second owner would fight it", () => {
  flagsOn("in-cluster-ca");
  vi.mocked(isLocalProvider).mockReturnValue(true);
  expect(providerFlagErrors(environment)).toEqual([
    "environment local turns on in-cluster-ca, which creates the cluster's own root CA, but a k3d environment's CA comes from kore trust install and the two would own one ClusterIssuer; turn in-cluster-ca off in the local environment overlay",
  ]);
});

test("in-cluster-ca on for a managed environment has no error", () => {
  flagsOn("in-cluster-ca");
  expect(providerFlagErrors(environment)).toEqual([]);
});

test("in-cluster-ca off needs nothing, even for a k3d environment", () => {
  flagsOn();
  vi.mocked(isLocalProvider).mockReturnValue(true);
  expect(providerFlagErrors(environment)).toEqual([]);
});

test("acme-dns01 on for a k3d environment is refused, because a k3d zone is not public and Let's Encrypt cannot check DNS-01 against it", () => {
  flagsOn("acme-dns01");
  vi.mocked(isLocalProvider).mockReturnValue(true);
  expect(providerFlagErrors(environment)).toEqual([
    "environment local turns on acme-dns01, which needs a real zone: a k3d environment has no public zone for Let's Encrypt to check DNS-01 against; turn acme-dns01 off in the local environment overlay",
  ]);
});

test("acme-dns01 on for a managed environment has no error", () => {
  flagsOn("acme-dns01");
  expect(providerFlagErrors(environment)).toEqual([]);
});

test("acme-dns01 off needs nothing, even for a k3d environment", () => {
  flagsOn();
  vi.mocked(isLocalProvider).mockReturnValue(true);
  expect(providerFlagErrors(environment)).toEqual([]);
});

test("both provider refusals report together for a k3d environment that turns both flags on", () => {
  flagsOn("in-cluster-ca", "acme-dns01");
  vi.mocked(isLocalProvider).mockReturnValue(true);
  expect(providerFlagErrors(environment)).toHaveLength(2);
});
