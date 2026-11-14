// Docs: docs/decisions/0076-k3d-replaces-minikube.md
import { beforeEach, expect, test, vi } from "vitest";
import { k3dErrors } from "./k3d-errors.js";
import { parseCidr } from "./registry-address.js";
import type { Environment } from "./types.js";
import { fakeEnvironment, fakeVersions, malformed } from "./config-support.js";

vi.mock("./registry-address.js");

const digest = `rancher/k3s@sha256:${"a".repeat(64)}`;
const versions = fakeVersions({}, { k3s: digest });

const validK3d = {
  clusterName: "kore-local",
  serviceCidr: "10.96.0.0/12",
  ports: [{ hostPort: 8080, loadBalancerPort: 30080 }],
};

/** A k3d overlay that passes every check, with the given fields replaced. */
function k3dEnvironment(overrides: Partial<Environment> = {}): Environment {
  return fakeEnvironment({
    k3d: validK3d,
    ...overrides,
  } as Partial<Environment>);
}

/** A k3d block with one field replaced; a field given undefined is removed. */
const withK3d = (field: string, value: unknown): Environment =>
  k3dEnvironment(
    malformed<Partial<Environment>>({
      k3d: { ...validK3d, [field]: value },
    }),
  );

beforeEach(() => {
  vi.mocked(parseCidr).mockReturnValue({ base: 0, size: 1 });
});

test("a sound k3d overlay with a pinned k3s image has no cluster errors", () => {
  expect(k3dErrors(k3dEnvironment(), versions)).toEqual([]);
  expect(vi.mocked(parseCidr).mock.calls).toEqual([["10.96.0.0/12"]]);
});

test("a k3d block on a non-k3d environment is refused, naming the provider", () => {
  const environment = fakeEnvironment({
    provider: "managed",
    k3d: validK3d,
  } as Partial<Environment>);
  expect(k3dErrors(environment, versions)).toEqual([
    "environment.k3d is only valid when provider is k3d, not managed; remove it",
  ]);
});

test("a non-k3d environment without a k3d block has no cluster errors", () => {
  expect(k3dErrors(fakeEnvironment({ provider: "managed" }), versions)).toEqual(
    [],
  );
});

test("a managed cluster block on a k3d overlay is refused, pointing at environment.k3d", () => {
  const environment = k3dEnvironment(
    malformed<Partial<Environment>>({ cluster: {} }),
  );
  expect(k3dErrors(environment, versions)).toEqual([
    "environment.cluster is only valid for provider managed; remove it and use environment.k3d for provider k3d",
  ]);
});

test("a k3d overlay whose k3d block is missing or not an object says it is required", () => {
  const missing = k3dEnvironment(
    malformed<Partial<Environment>>({ k3d: undefined }),
  );
  const list = k3dEnvironment(malformed<Partial<Environment>>({ k3d: [] }));
  expect(k3dErrors(missing, versions)).toEqual([
    "environment.k3d is required when provider is k3d",
  ]);
  expect(k3dErrors(list, versions)).toEqual([
    "environment.k3d is required when provider is k3d",
  ]);
});

test("a k3d field the block does not know is refused, and the image field points at the pin", () => {
  const environment = k3dEnvironment(
    malformed<Partial<Environment>>({
      k3d: { ...validK3d, image: "rancher/k3s:v1", retries: 2 },
    }),
  );
  expect(k3dErrors(environment, versions)).toEqual([
    "environment.k3d.image is not configurable; the k3s image comes from versions.images.k3s",
    "environment.k3d.retries is not a k3d field; use clusterName, serviceCidr, ports, servers or agents",
  ]);
});

test("a missing cluster name is required, and a malformed one names the rule", () => {
  expect(k3dErrors(withK3d("clusterName", undefined), versions)).toEqual([
    "environment.k3d.clusterName is required",
  ]);
  expect(k3dErrors(withK3d("clusterName", "Kore_Local"), versions)).toEqual([
    "environment.k3d.clusterName must be lowercase letters, digits and hyphens, starting and ending alphanumeric, got Kore_Local",
  ]);
});

test("a missing service CIDR is required, and one the parser rejects names the example", () => {
  expect(k3dErrors(withK3d("serviceCidr", undefined), versions)).toEqual([
    "environment.k3d.serviceCidr is required",
  ]);
  vi.mocked(parseCidr).mockReturnValue(undefined);
  expect(k3dErrors(withK3d("serviceCidr", "ten"), versions)).toEqual([
    "environment.k3d.serviceCidr must be an IPv4 CIDR such as 10.96.0.0/12, got ten",
  ]);
});

test("servers must be at least 1 and agents at least 0 when they are declared", () => {
  expect(k3dErrors(withK3d("servers", 0), versions)).toEqual([
    "environment.k3d.servers must be an integer of at least 1",
  ]);
  expect(k3dErrors(withK3d("agents", -1), versions)).toEqual([
    "environment.k3d.agents must be an integer of at least 0",
  ]);
  expect(k3dErrors(withK3d("agents", 0), versions)).toEqual([]);
});

test("ports must be a non-empty list, and each must name a host and a load balancer port from 1 to 65535", () => {
  expect(k3dErrors(withK3d("ports", []), versions)).toEqual([
    "environment.k3d.ports must be a non-empty list of { hostPort, loadBalancerPort }",
  ]);
  expect(
    k3dErrors(
      withK3d("ports", [{ hostPort: 0, loadBalancerPort: 70000 }]),
      versions,
    ),
  ).toEqual([
    "environment.k3d.ports[0].hostPort must be an integer from 1 to 65535",
    "environment.k3d.ports[0].loadBalancerPort must be an integer from 1 to 65535",
  ]);
});

test("a host port mapped twice is reported once, and a bad one is not reported as a duplicate", () => {
  const ports = [
    { hostPort: 8080, loadBalancerPort: 30080 },
    { hostPort: 8080, loadBalancerPort: 30081 },
    { hostPort: 0, loadBalancerPort: 30082 },
    { hostPort: 0, loadBalancerPort: 30083 },
  ];
  expect(k3dErrors(withK3d("ports", ports), versions)).toEqual([
    "environment.k3d.ports[2].hostPort must be an integer from 1 to 65535",
    "environment.k3d.ports[3].hostPort must be an integer from 1 to 65535",
    "environment.k3d.ports maps host port 8080 twice",
  ]);
});

test("the kube context must be k3d-<cluster name> when it is set", () => {
  const environment = k3dEnvironment({ kubeContext: "k3d-other" });
  expect(k3dErrors(environment, versions)).toEqual([
    "environment.kubeContext must be k3d-kore-local for k3d cluster kore-local, got k3d-other",
  ]);
});

test("the k3s image must be digest-pinned, and an unpinned or missing one is refused", () => {
  expect(
    k3dErrors(k3dEnvironment(), fakeVersions({}, { k3s: "rancher/k3s:v1.30" })),
  ).toEqual([
    "versions.images.k3s must be a digest-pinned image for provider k3d",
  ]);
  expect(k3dErrors(k3dEnvironment(), fakeVersions())).toEqual([
    "versions.images.k3s must be a digest-pinned image for provider k3d",
  ]);
});
