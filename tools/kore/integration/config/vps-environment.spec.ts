import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import {
  findRoot,
  loadRepository,
  validateRepository,
} from "../../src/config/index.js";

// Docs: docs/decisions/0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md

test("the vps overlay validates as a managed environment on the persistent k3s node, with no validation error", async () => {
  const repository = await loadRepository("vps");
  assert.deepEqual(await validateRepository(repository), []);
  const { environment } = repository;
  assert.equal(environment.name, "vps");
  assert.equal(environment.provider, "managed");
  assert.equal(environment.kubeContext, "kore-vps");
  assert.equal(environment.cluster?.profile, "external");
  assert.equal(environment.cluster?.kubernetesVersion, "1.37.2");
});

test("the vps overlay lists every feature flag and holds each one off, so none turns on until a live run and harness flag activate turn it on", async () => {
  const { environment } = await loadRepository("vps");
  const features = Object.entries(environment.features ?? {});
  assert.ok(features.length > 0, "the flags are listed, not left implicit");
  assert.deepEqual(
    features.filter(([, value]) => value !== false),
    [],
  );
});

test("the vps overlay uses the local domain convention and the cluster's own local-path storage provisioner", async () => {
  const { environment } = await loadRepository("vps");
  assert.deepEqual(environment.platform, {
    domain: "kore.internal",
    organizationId: "platform",
  });
  const root = await findRoot();
  const storage = await readFile(
    join(root, "infra/environments/vps/values/platform-storage.yaml"),
    "utf8",
  );
  assert.equal(
    storage.trim(),
    "storage:\n  provisioner: rancher.io/local-path",
  );
});

test("the vps cluster sizing leaves room for the agents VM's 40 GiB cap and the host on the 64 GiB machine", async () => {
  const { environment } = await loadRepository("vps");
  assert.equal(environment.cluster?.cpus, 4);
  assert.equal(environment.cluster?.memoryMB, 20480);
  assert.equal(environment.cluster?.diskSize, "300g");
});
