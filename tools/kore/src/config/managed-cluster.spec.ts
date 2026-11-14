import { expect, test } from "vitest";
import { managedCluster, type ManagedCluster } from "./managed-cluster.js";
import { fakeEnvironment } from "./config-support.js";

test("a managed environment's declared cluster settings are returned as declared", () => {
  const cluster = { cpus: 2, memoryMB: 4096 } as ManagedCluster;
  const environment = fakeEnvironment({
    name: "managed-example",
    provider: "managed",
    cluster,
  });
  expect(managedCluster(environment)).toBe(cluster);
});

test("an environment with no cluster settings fails naming it and its provider, not with an untyped read", () => {
  const environment = fakeEnvironment({ name: "local", provider: "k3d" });
  expect(() => managedCluster(environment)).toThrow(
    "environment local has no cluster settings; it is a k3d overlay, so managed-cluster settings do not apply to it",
  );
});
