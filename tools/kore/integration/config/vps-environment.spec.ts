import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
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

test("the vps registry is an in-cluster ClusterIP at 10.43.0.50:5000, inside the k3s service CIDR and clear of the services the cluster runs", async () => {
  const { environment } = await loadRepository("vps");
  assert.equal(environment.registry?.address, "10.43.0.50:5000");
  assert.equal(environment.cluster?.serviceCidr, "10.43.0.0/16");
});

test("the vps gateway takes its certificate from the internal CA that local uses, not from ACME", async () => {
  const root = await findRoot();
  const config = await readFile(
    join(root, "infra/environments/vps/values/platform-config.yaml"),
    "utf8",
  );
  assert.match(config, /^issuer: \{ name: kore-local-ca \}$/m);
  assert.match(config, /certificateSecret: kore-local-tls/);
  assert.doesNotMatch(config, /managed-cluster-issuer/);
});

test("the vps policy controller trusts only the in-cluster registry's CA, as local does, so signatures are read over verified TLS", async () => {
  const { environment } = await loadRepository("vps");
  assert.ok(
    environment.componentValues?.["policy-controller"]?.includes(
      "infra/environments/vps/values/policy-controller.yaml",
    ),
    "the registry CA values are layered beside the mirror values",
  );
  const root = await findRoot();
  const values = await readFile(
    join(root, "infra/environments/vps/values/policy-controller.yaml"),
    "utf8",
  );
  assert.match(
    values,
    /"registryCaBundle": \{ "name": "kore-registry-ca", "key": "ca.crt" \}/,
  );
});

test("the vps secrets directory holds no encrypted document and no rule that reuses local's age recipient, until the owner creates the environment's own recipient", async () => {
  const root = await findRoot();
  const directory = join(root, "infra/environments/vps/secrets");
  const names = (await readdir(directory)).sort();
  assert.deepEqual(
    names.filter((name) => name.endsWith(".enc.yaml")),
    [],
  );
  assert.ok(
    names.includes("README.md"),
    "the owner steps are recorded beside it",
  );
  const sops = await readFile(join(root, ".sops.yaml"), "utf8");
  const local =
    /infra\/environments\/local\/secrets[\s\S]*?age: (age1\S+)/.exec(sops)?.[1];
  const vps = /infra\/environments\/vps\/secrets[\s\S]*?age: (\S+)/.exec(
    sops,
  )?.[1];
  assert.ok(local !== undefined, "local keeps its own recipient");
  assert.equal(
    vps === undefined || vps !== local,
    true,
    "vps never reuses local's recipient",
  );
});
