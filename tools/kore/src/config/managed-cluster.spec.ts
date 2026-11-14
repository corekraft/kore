import { expect, test } from "vitest";
import { managedCluster } from "./managed-cluster.js";
import type { Environment } from "./types.js";

test("a managed environment's declared cluster settings are returned as declared", () => {
  const cluster = { region: "eu-west-1" } as unknown as Environment["cluster"];
  const environment = {
    name: "managed-example",
    provider: "managed",
    cluster,
  } as unknown as Environment;
  expect(managedCluster(environment)).toBe(cluster);
});

test("an environment with no cluster settings fails naming it and its provider, not with an untyped read", () => {
  const environment = {
    name: "local",
    provider: "k3d",
  } as unknown as Environment;
  expect(() => managedCluster(environment)).toThrow(
    "environment local has no cluster settings; it is a k3d overlay, so managed-cluster settings do not apply to it",
  );
});
