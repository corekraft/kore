import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";
import type { Repository } from "./types.js";

async function variant(
  change: (repository: Repository) => Repository,
): Promise<Repository> {
  return change(await loadRepository("local"));
}

test("local declares its service range and pins the registry inside it", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.environment.cluster.serviceCidr, "10.96.0.0/12");
  assert.equal(repository.registryClusterIP, "10.96.0.50");
});

test("a registry clusterIP outside the service range is rejected with the fix", async () => {
  const repository = await variant((base) => ({
    ...base,
    registryClusterIP: "10.200.0.50",
  }));
  await assert.rejects(
    validateRepository(repository),
    /10\.200\.0\.50 is outside cluster\.serviceCidr 10\.96\.0\.0\/12.*change service\.clusterIP/s,
  );
});

test("a policy glob that names another registry address is rejected", async () => {
  const repository = await variant((base) => ({
    ...base,
    imageTrustValues: {
      trust: {
        ...(base.imageTrustValues?.["trust"] as object),
        images: ["10.96.0.51:5000/**"],
      },
    },
  }));
  await assert.rejects(
    validateRepository(repository),
    /10\.96\.0\.51:5000\/\*\* must name the registry address 10\.96\.0\.50:5000/,
  );
});

test("a malformed service range is rejected", async () => {
  const repository = await variant((base) => ({
    ...base,
    environment: {
      ...base.environment,
      cluster: { ...base.environment.cluster, serviceCidr: "nonsense" },
    },
  }));
  await assert.rejects(
    validateRepository(repository),
    /cluster\.serviceCidr must be an IPv4 CIDR/,
  );
});

test("a pinned registry needs a declared service range", async () => {
  const repository = await variant((base) => {
    const { serviceCidr: _drop, ...cluster } = base.environment.cluster;
    return { ...base, environment: { ...base.environment, cluster } };
  });
  await assert.rejects(
    validateRepository(repository),
    /set cluster\.serviceCidr/,
  );
});

test("environments without a pinned registry need no service range", async () => {
  await validateRepository(await loadRepository("managed-example"));
});
