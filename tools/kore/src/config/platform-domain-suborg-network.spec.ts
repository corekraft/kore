// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { platformHelmArgs } from "./platform-domain.js";

// Issue 1552: with suborg-tenancy on, the platform-apis chart is handed the cluster's
// service range, which its suborg NetworkPolicies exclude from open internet egress. The
// range comes from the environment the cluster is provisioned with, so the chart never
// guesses it. Off, nothing is passed and every render is what it was.

const platform = {
  platform: { domain: "kore.internal", organizationId: "platform" },
  gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
};

const cluster = {
  profile: "external",
  kubernetesVersion: "1.37.2",
  driver: "external",
  containerRuntime: "containerd",
  cpus: 4,
  memoryMB: 20480,
  diskSize: "300g",
};

test("with suborg-tenancy on the platform-apis chart is handed the overlay's service range", () => {
  const environment = fakeEnvironment({
    ...platform,
    provider: "managed",
    features: { "suborg-tenancy": true },
    cluster: { ...cluster, serviceCidr: "10.43.0.0/16" },
  });
  expect(platformHelmArgs(environment, "kore-platform-apis")).toContain(
    "suborgNetwork.serviceCidr=10.43.0.0/16",
  );
});

test("on k3d the service range is the k3d cluster's, not the overlay's cluster block", () => {
  const environment = fakeEnvironment({
    ...platform,
    provider: "k3d",
    features: { "suborg-tenancy": true },
    k3d: { clusterName: "kore", serviceCidr: "10.96.0.0/12", ports: [] },
  });
  expect(platformHelmArgs(environment, "kore-platform-apis")).toContain(
    "suborgNetwork.serviceCidr=10.96.0.0/12",
  );
});

test("with no service range recorded nothing is passed, so the chart refuses to render rather than guess", () => {
  const environment = fakeEnvironment({
    ...platform,
    provider: "managed",
    features: { "suborg-tenancy": true },
    cluster,
  });
  expect(
    platformHelmArgs(environment, "kore-platform-apis").some((arg) =>
      arg.startsWith("suborgNetwork."),
    ),
  ).toBe(false);
});

test("with suborg-tenancy off, or on another component, no suborg network value is passed", () => {
  const k3d = { clusterName: "kore", serviceCidr: "10.96.0.0/12", ports: [] };
  const off = fakeEnvironment({
    ...platform,
    features: { "suborg-tenancy": false },
    k3d,
  });
  expect(platformHelmArgs(off, "kore-platform-apis")).not.toContain(
    "suborgNetwork.serviceCidr=10.96.0.0/12",
  );
  const on = fakeEnvironment({
    ...platform,
    features: { "suborg-tenancy": true },
    k3d,
  });
  expect(
    platformHelmArgs(on, "kore-platform-config").some((arg) =>
      arg.startsWith("suborgNetwork."),
    ),
  ).toBe(false);
});
