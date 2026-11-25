// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import {
  featureEnabled,
  suborgNetworkPolicyFlag,
  suborgTenancyFlag,
} from "./features.js";
import { internalGateway } from "./gateways.js";
import {
  clusterResolutionArgs,
  localCaConfigMap,
  suborgNetworkArgs,
  suborgServiceRangeErrors,
} from "./platform-cluster-resolution.js";
import type { Environment } from "./types.js";

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  platformDnsFlag: "platform-dns",
  suborgNetworkPolicyFlag: "suborg-network-policy",
  suborgTenancyFlag: "suborg-tenancy",
}));
vi.mock("./gateways.js", () => ({ internalGateway: vi.fn() }));

const environment = { name: "local" } as Environment;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(internalGateway).mockReturnValue({
    name: "kore-gateway",
    namespace: "kore-system",
  } as ReturnType<typeof internalGateway>);
});

/** Only the two suborg flags are answered; featureEnabled is mocked, so each flag is set here. */
function suborgFlags(tenancy: boolean, network: boolean): void {
  vi.mocked(featureEnabled).mockImplementation((_environment, flag) => {
    if (flag === suborgTenancyFlag) {
      return tenancy;
    }
    return flag === suborgNetworkPolicyFlag ? network : false;
  });
}

const cluster = {
  profile: "external",
  kubernetesVersion: "1.37.2",
  driver: "external",
  containerRuntime: "containerd",
  cpus: 4,
  memoryMB: 20480,
  diskSize: "300g",
};

/** A managed overlay whose cluster block records the given service range, or none. */
function managed(serviceCidr?: string): Environment {
  return fakeEnvironment({
    name: "managed-example",
    provider: "managed",
    cluster: serviceCidr === undefined ? cluster : { ...cluster, serviceCidr },
  });
}

const k3dWithRange = fakeEnvironment({
  name: "local",
  provider: "k3d",
  k3d: { clusterName: "kore", serviceCidr: "10.96.0.0/12", ports: [] },
});

test("the CA ConfigMap name is the one the portal and local trust installs use", () => {
  expect(localCaConfigMap).toBe("kore-local-ca");
});

test("with platform-dns off, no component takes a resolution argument", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(clusterResolutionArgs(environment, "kore-platform-backstage")).toEqual(
    [],
  );
  expect(clusterResolutionArgs(environment, "kore-platform-dns")).toEqual([]);
});

test("with platform-dns on, the portal is handed the CA ConfigMap it trusts", () => {
  expect(clusterResolutionArgs(environment, "kore-platform-backstage")).toEqual(
    ["--set-string", "localCa.configMap=kore-local-ca"],
  );
});

test("with platform-dns on, platform-dns is handed the Gateway whose Service the zone rewrites to", () => {
  expect(clusterResolutionArgs(environment, "kore-platform-dns")).toEqual([
    "--set-string",
    "gateway.name=kore-gateway",
    "--set-string",
    "gateway.namespace=kore-system",
  ]);
});

test("no other component takes a resolution argument, even with platform-dns on", () => {
  expect(clusterResolutionArgs(environment, "kore-platform-config")).toEqual(
    [],
  );
});

test("with both suborg flags on, the platform-apis chart is handed the overlay's recorded service range", () => {
  suborgFlags(true, true);
  expect(
    suborgNetworkArgs(managed("10.43.0.0/16"), "kore-platform-apis"),
  ).toEqual(["--set-string", "suborgNetwork.serviceCidr=10.43.0.0/16"]);
});

test("on k3d the service range handed to the platform-apis chart is the k3d cluster's, not the cluster block's", () => {
  suborgFlags(true, true);
  const k3dOverlay = fakeEnvironment({
    ...k3dWithRange,
    cluster: { ...cluster, serviceCidr: "10.43.0.0/16" },
  });
  expect(suborgNetworkArgs(k3dOverlay, "kore-platform-apis")).toEqual([
    "--set-string",
    "suborgNetwork.serviceCidr=10.96.0.0/12",
  ]);
});

test("with either suborg flag off, no suborg network argument is passed", () => {
  suborgFlags(true, false);
  expect(
    suborgNetworkArgs(managed("10.43.0.0/16"), "kore-platform-apis"),
  ).toEqual([]);
  suborgFlags(false, true);
  expect(
    suborgNetworkArgs(managed("10.43.0.0/16"), "kore-platform-apis"),
  ).toEqual([]);
});

test("no component other than the platform-apis chart takes a suborg network argument", () => {
  suborgFlags(true, true);
  expect(
    suborgNetworkArgs(managed("10.43.0.0/16"), "kore-platform-config"),
  ).toEqual([]);
});

test("with no service range recorded no suborg network argument is passed, so the chart refuses to render rather than guess", () => {
  suborgFlags(true, true);
  expect(suborgNetworkArgs(managed(), "kore-platform-apis")).toEqual([]);
});

test("with both suborg flags on and no service range recorded, validation names both flags and the field to set", () => {
  suborgFlags(true, true);
  const errors = suborgServiceRangeErrors(managed());
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatch(
    /suborg-tenancy and suborg-network-policy are on in the managed-example overlay but it records no cluster\.serviceCidr/,
  );
  expect(errors[0]).toMatch(
    /set cluster\.serviceCidr in the managed-example overlay/,
  );
});

test("on k3d the missing range validation names is k3d.serviceCidr", () => {
  suborgFlags(true, true);
  const k3dOverlay = fakeEnvironment({ name: "local", provider: "k3d" });
  expect(suborgServiceRangeErrors(k3dOverlay)).toEqual([
    expect.stringMatching(/records no k3d\.serviceCidr/),
  ]);
});

test("validation reports nothing when a range is recorded, or when either suborg flag is off", () => {
  suborgFlags(true, true);
  expect(suborgServiceRangeErrors(managed("10.43.0.0/16"))).toEqual([]);
  suborgFlags(true, false);
  expect(suborgServiceRangeErrors(managed())).toEqual([]);
  suborgFlags(false, true);
  expect(suborgServiceRangeErrors(managed())).toEqual([]);
});
