// Docs: docs/decisions/0031-registry-address-platform-variable.md
import { expect, test } from "vitest";
import {
  fakeEnvironment,
  fakeRepository,
  malformed,
} from "./config-support.js";
import {
  parseCidr,
  registryAddressErrors,
  registryHelmArgs,
  registryPlan,
} from "./registry-address.js";
import type { Environment } from "./types.js";

const inCluster = (address: string) =>
  fakeEnvironment({
    registry: { address },
    provider: "k3d",
    k3d: { clusterName: "kore-local", serviceCidr: "10.96.0.0/12", ports: [] },
  });

test("a CIDR is read as its first address and its size in addresses", () => {
  expect(parseCidr("10.96.0.0/12")).toEqual({ base: 174063616, size: 1048576 });
});

test("a CIDR with a prefix past 32, an octet past 255, or no slash is not read", () => {
  expect(parseCidr("10.0.0.0/33")).toBeUndefined();
  expect(parseCidr("300.0.0.0/8")).toBeUndefined();
  expect(parseCidr("10.0.0.0")).toBeUndefined();
});

test("an in-cluster address is an IP literal, so its plan pins a ClusterIP and keeps its port", () => {
  expect(
    registryPlan(fakeEnvironment({ registry: { address: "10.96.0.50:5000" } })),
  ).toEqual({
    address: "10.96.0.50:5000",
    host: "10.96.0.50",
    port: "5000",
    clusterIP: "10.96.0.50",
  });
});

test("a hostname plan pins no ClusterIP and names no port when the address has none", () => {
  const plan = registryPlan(
    fakeEnvironment({ registry: { address: "registry.example.internal" } }),
  );
  expect(plan).toEqual({
    address: "registry.example.internal",
    host: "registry.example.internal",
  });
  expect(plan).not.toHaveProperty("clusterIP");
  expect(plan).not.toHaveProperty("port");
});

test("an environment with no registry address is refused, naming the environment", () => {
  expect(() =>
    registryPlan(
      fakeEnvironment({
        name: "managed-example",
        registry: malformed<{ address: string }>(undefined),
      }),
    ),
  ).toThrow(
    "environment managed-example must declare registry.address as host[:port]",
  );
});

test("the oci registry receives its address, ClusterIP and port when the address is in-cluster", () => {
  expect(
    registryHelmArgs(inCluster("10.96.0.50:5000"), "oci-registry"),
  ).toEqual([
    "--set-string",
    "platform.registry.address=10.96.0.50:5000",
    "--set-string",
    "service.clusterIP=10.96.0.50",
    "--set-string",
    "service.port=5000",
  ]);
});

test("the oci registry takes the default port when the in-cluster address names none", () => {
  expect(registryHelmArgs(inCluster("10.96.0.50"), "oci-registry")).toContain(
    "service.port=5000",
  );
});

test("the image policy receives the mirror repository, and no other component does", () => {
  const environment = fakeEnvironment({
    registry: { address: "registry.example.internal" },
    platformMirror: "ghcr.io/corekraft/kore/mirror",
  });
  expect(registryHelmArgs(environment, "kore-image-policy")).toEqual([
    "--set-string",
    "platform.registry.address=registry.example.internal",
    "--set-string",
    "platform.mirror.repository=ghcr.io/corekraft/kore/mirror",
  ]);
  expect(registryHelmArgs(environment, "kore-ui")).toEqual([
    "--set-string",
    "platform.registry.address=registry.example.internal",
  ]);
});

test("a registry address inside the cluster service range passes", () => {
  expect(
    registryAddressErrors(
      fakeRepository({ environment: inCluster("10.96.0.50:5000") }),
    ),
  ).toEqual([]);
});

test("an in-cluster address outside the service range is refused, with the range it must sit in", () => {
  expect(
    registryAddressErrors(
      fakeRepository({ environment: inCluster("10.128.0.50:5000") }),
    ),
  ).toEqual([
    "registry.address 10.128.0.50:5000 is outside k3d.serviceCidr 10.96.0.0/12; change registry.address to an address inside the range",
  ]);
});

test("a registry address that is neither host nor host and port is refused, showing what was given", () => {
  expect(
    registryAddressErrors(
      fakeRepository({ environment: inCluster("bad host!") }),
    ),
  ).toEqual([
    'registry.address must be host[:port] (for example 10.96.0.50:5000 or registry.example.internal) in environment local, got "bad host!"',
  ]);
});

test("a managed cluster's service range must be an IPv4 CIDR", () => {
  const environment = fakeEnvironment({
    provider: "managed",
    registry: { address: "registry.example.internal" },
    cluster: malformed<NonNullable<Environment["cluster"]>>({
      serviceCidr: "not-a-range",
    }),
  });
  expect(registryAddressErrors(fakeRepository({ environment }))).toEqual([
    "cluster.serviceCidr must be an IPv4 CIDR such as 10.96.0.0/12, got not-a-range",
  ]);
});

test("a managed cluster with an in-cluster address must declare the service range that holds it", () => {
  const environment = fakeEnvironment({
    provider: "managed",
    registry: { address: "10.96.0.50:5000" },
    cluster: malformed<NonNullable<Environment["cluster"]>>({}),
  });
  expect(registryAddressErrors(fakeRepository({ environment }))).toEqual([
    "registry.address 10.96.0.50:5000 is an in-cluster ClusterIP; set cluster.serviceCidr in environment local so the cluster is provisioned with a range that contains it",
  ]);
});

test("a component's values may not set the registry service fields, which the address derives", () => {
  const repository = fakeRepository({
    environment: inCluster("10.96.0.50:5000"),
    registryComponentValues: {
      "oci-registry": { service: { clusterIP: "10.96.0.50", port: 5000 } },
    },
  });
  expect(registryAddressErrors(repository)).toEqual([
    "oci-registry values must not set service.clusterIP; it is derived from registry.address in environment local",
    "oci-registry values must not set service.port; it is derived from registry.address in environment local",
    "oci-registry values hardcode the registry host 10.96.0.50; remove it, registry.address in environment local is the only place it is written",
  ]);
});

test("a component's values may not hardcode the registry host, anywhere in their tree", () => {
  const repository = fakeRepository({
    environment: fakeEnvironment({
      registry: { address: "registry.example.internal" },
    }),
    registryComponentValues: {
      "kore-image-policy": {
        trust: { images: ["registry.example.internal/app:1"] },
      },
    },
  });
  expect(registryAddressErrors(repository)).toEqual([
    "kore-image-policy values must not set trust.images; it is derived from registry.address in environment local",
    "kore-image-policy values hardcode the registry host registry.example.internal; remove it, registry.address in environment local is the only place it is written",
  ]);
});
