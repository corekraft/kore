import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";
import { minikubeCluster } from "./minikube-cluster.js";
import { registryPlan } from "./registry-address.js";
import type { Repository } from "./types.js";

async function withAddress(name: string, address: string): Promise<Repository> {
  const base = await loadRepository(name);
  return {
    ...base,
    environment: { ...base.environment, registry: { address } },
  };
}

test("local declares one registry address and derives the Service pin from it", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.environment.registry.address, "10.96.0.50:5000");
  assert.deepEqual(registryPlan(repository.environment), {
    address: "10.96.0.50:5000",
    host: "10.96.0.50",
    port: "5000",
    clusterIP: "10.96.0.50",
  });
});

test("a hostname address derives no Service pin", async () => {
  const repository = await loadRepository("managed-example");
  const plan = registryPlan(repository.environment);
  assert.equal(plan.address, "registry.example.internal");
  assert.equal(plan.clusterIP, undefined);
});

test("an address outside the service range is rejected with the fix", async () => {
  const repository = await withAddress("local", "10.200.0.50:5000");
  await assert.rejects(
    validateRepository(repository),
    /registry\.address 10\.200\.0\.50:5000.*outside cluster\.serviceCidr 10\.96\.0\.0\/12/s,
  );
});

test("a malformed address is rejected", async () => {
  for (const address of ["", "http://10.96.0.50:5000", "host/path", "a b"]) {
    await assert.rejects(
      validateRepository(await withAddress("local", address)),
      /registry\.address must be host\[:port\]/,
    );
  }
});

test("an in-cluster IP address needs a declared service range", async () => {
  const base = await loadRepository("local");
  const { serviceCidr: _drop, ...cluster } = minikubeCluster(base.environment);
  await assert.rejects(
    validateRepository({
      ...base,
      environment: { ...base.environment, cluster },
    }),
    /set cluster\.serviceCidr/,
  );
});

test("a hostname address needs no service range", async () => {
  await validateRepository(
    await withAddress("managed-example", "registry.other.internal:5000"),
  );
});

test("values files that hardcode the registry are rejected", async () => {
  const base = await loadRepository("local");
  for (const [component, values, pattern] of [
    [
      "oci-registry",
      { service: { clusterIP: "10.96.0.50" } },
      /service\.clusterIP/,
    ],
    ["oci-registry", { service: { port: 5000 } }, /service\.port/],
    [
      "kore-image-policy",
      { trust: { images: ["10.96.0.50:5000/**"] } },
      /trust\.images/,
    ],
  ] as const) {
    await assert.rejects(
      validateRepository({
        ...base,
        registryComponentValues: { [component]: values },
      } as Repository),
      pattern,
    );
  }
});
