import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";
import { loadManagedLocal } from "../testing/index.js";
import { managedCluster } from "./managed-cluster.js";
import type { Environment, Repository } from "./types.js";

const k3d = {
  clusterName: "kore-local",
  serviceCidr: "10.96.0.0/12",
  ports: [{ hostPort: 8443, loadBalancerPort: 443 }],
} as const;

async function validationError(repository: Repository): Promise<string> {
  try {
    await validateRepository({
      ...repository,
      seeds: { seeds: [] },
      approved: { images: [] },
    });
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

async function k3dMessage(
  mutate: (environment: Record<string, unknown>) => Record<string, unknown>,
): Promise<string> {
  const base = await loadRepository("local");
  const environment = mutate({
    ...base.environment,
    provider: "k3d",
    kubeContext: "k3d-kore-local",
    k3d,
  });
  try {
    await validateRepository({
      ...base,
      seeds: { seeds: [] },
      approved: { images: [] },
      environment: environment as unknown as Environment,
    });
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

test("a k3d overlay with a k3d block, context, CIDR and port mappings validates", async () => {
  assert.equal(await k3dMessage((e) => e), "");
});

test("a k3d overlay may set one server and agents explicitly", async () => {
  assert.equal(
    await k3dMessage((e) => ({ ...e, k3d: { ...k3d, servers: 1, agents: 2 } })),
    "",
  );
});

test("a k3d overlay without the k3d block fails and names the missing block", async () => {
  const message = await k3dMessage(({ k3d: _k3d, ...e }) => e);
  assert.match(message, /environment\.k3d is required when provider is k3d/);
});

test("a k3d overlay rejects a managed-only cluster block and says to remove it", async () => {
  const base = await loadManagedLocal();
  const message = await k3dMessage((e) => ({
    ...e,
    cluster: base.environment.cluster,
  }));
  assert.match(
    message,
    /environment\.cluster is only valid for provider managed; remove it and use environment\.k3d for provider k3d/,
  );
});

test("a k3d overlay rejects a k3d field it does not know, pointing image at the pin", async () => {
  const message = await k3dMessage((e) => ({
    ...e,
    k3d: { ...k3d, image: "rancher/k3s:latest", driver: "docker" },
  }));
  assert.match(
    message,
    /environment\.k3d\.image is not configurable; the k3s image comes from versions\.images\.k3s/,
  );
  assert.match(message, /environment\.k3d\.driver is not a k3d field/);
});

test("a k3d overlay rejects a malformed cluster name, CIDR, ports and counts", async () => {
  const message = await k3dMessage((e) => ({
    ...e,
    k3d: {
      clusterName: "Bad_Name",
      serviceCidr: "not-a-cidr",
      ports: [
        { hostPort: 0, loadBalancerPort: 443 },
        { hostPort: 8443, loadBalancerPort: "https" },
        { hostPort: 8443, loadBalancerPort: 80 },
      ],
      servers: 0,
      agents: -1,
    },
  }));
  assert.match(message, /environment\.k3d\.clusterName must be/);
  assert.match(message, /environment\.k3d\.serviceCidr must be an IPv4 CIDR/);
  assert.match(
    message,
    /environment\.k3d\.ports\[0\]\.hostPort must be an integer from 1 to 65535/,
  );
  assert.match(
    message,
    /environment\.k3d\.ports\[1\]\.loadBalancerPort must be an integer from 1 to 65535/,
  );
  assert.match(message, /environment\.k3d\.ports maps host port 8443 twice/);
  assert.match(
    message,
    /environment\.k3d\.servers must be an integer of at least 1/,
  );
  assert.match(
    message,
    /environment\.k3d\.agents must be an integer of at least 0/,
  );
});

test("a k3d overlay with missing fields reports each one", async () => {
  const message = await k3dMessage((e) => ({ ...e, k3d: {} }));
  assert.match(message, /environment\.k3d\.clusterName is required/);
  assert.match(message, /environment\.k3d\.serviceCidr is required/);
  assert.match(message, /environment\.k3d\.ports must be a non-empty list/);
});

test("a k3d overlay whose kube context is not k3d-<cluster name> fails", async () => {
  const message = await k3dMessage((e) => ({
    ...e,
    kubeContext: "kore-local",
  }));
  assert.match(
    message,
    /environment\.kubeContext must be k3d-kore-local for k3d cluster kore-local, got kore-local/,
  );
});

test("a k3d overlay's registry address must lie inside k3d.serviceCidr", async () => {
  const message = await k3dMessage((e) => ({
    ...e,
    registry: { address: "192.168.1.5:5000" },
  }));
  assert.match(
    message,
    /registry\.address 192\.168\.1\.5:5000 is outside k3d\.serviceCidr 10\.96\.0\.0\/12/,
  );
});

test("a k3d overlay without a pinned k3s image fails before any cluster is touched", async () => {
  const base = await loadRepository("local");
  const { k3s: _k3s, ...images } = base.versions.images;
  const { cluster: _cluster, ...rest } = base.environment;
  await assert.rejects(
    validateRepository({
      ...base,
      seeds: { seeds: [] },
      approved: { images: [] },
      versions: { ...base.versions, images },
      environment: {
        ...rest,
        provider: "k3d",
        kubeContext: "k3d-kore-local",
        k3d,
      } as unknown as Environment,
    }),
    /versions\.images\.k3s must be a digest-pinned image for provider k3d/,
  );
});

test("a managed overlay still validates and rejects a k3d block", async () => {
  const base = await loadRepository("managed-example");
  await validateRepository(base);
  await assert.rejects(
    validateRepository({
      ...base,
      environment: { ...base.environment, k3d } as unknown as Environment,
    }),
    /environment\.k3d is only valid when provider is k3d/,
  );
});

test("a minikube-shaped overlay is rejected with the one step that fixes it", async () => {
  const base = await loadManagedLocal();
  const message = await validationError({
    ...base,
    environment: { ...base.environment, provider: "minikube" },
  } as unknown as Repository);
  assert.equal(
    message,
    "environment.provider minikube is no longer supported; set environment.provider to k3d, add environment.k3d and remove environment.cluster (ADR 0076)",
  );
  assert.doesNotMatch(message, /remove environment\.k3d/);
});

test("a bad k3d.serviceCidr is reported exactly once", async () => {
  const message = await k3dMessage((e) => ({
    ...e,
    k3d: { ...k3d, serviceCidr: "not-a-cidr" },
  }));
  assert.equal(message.split("serviceCidr must be").length - 1, 1);
});

test("a k3d overlay cannot reach managed-cluster settings and says so", async () => {
  const base = await loadManagedLocal();
  const k3dEnvironment = {
    ...(await loadRepository("local")).environment,
  } as Environment;
  assert.throws(
    () => managedCluster(k3dEnvironment),
    /environment local has no cluster settings; it is a k3d overlay/,
  );
  assert.equal(managedCluster(base.environment).profile, "kore-local");
});

test("the environment schema accepts only the k3d and managed providers", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../../../../infra/environments/schema.json", import.meta.url),
      "utf8",
    ),
  ) as { properties: { provider: { enum: string[] } } };
  assert.deepEqual(schema.properties.provider.enum, ["k3d", "managed"]);
});

test("a k3d overlay whose k3d block is not an object fails with the missing-block message", async () => {
  const message = await k3dMessage((e) => ({ ...e, k3d: "kore-local" }));
  assert.match(message, /environment\.k3d is required when provider is k3d/);
});

test("a k3d overlay rejects an unparsable service CIDR with the k3d field name", async () => {
  const message = await k3dMessage((e) => ({
    ...e,
    k3d: { ...k3d, serviceCidr: "999.1.1.1/99" },
  }));
  assert.match(message, /environment\.k3d\.serviceCidr must be an IPv4 CIDR/);
});
