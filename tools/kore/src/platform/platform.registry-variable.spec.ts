import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { releaseArgs } from "../app/release.js";
import { loadRepository, type Repository } from "../config/index.js";
import { helmTemplateArgs, helmUpgradeArgs } from "./helm.js";

function component(repository: Repository, name: string) {
  const found = repository.catalog.components.find((c) => c.name === name);
  assert.ok(found, name);
  return found;
}

function value(args: string[], key: string): string | undefined {
  const index = args.findIndex((arg) => arg.startsWith(`${key}=`));
  return index < 0 ? undefined : args[index]!.slice(key.length + 1);
}

async function withAddress(name: string, address: string) {
  const base = await loadRepository(name);
  return {
    ...base,
    environment: { ...base.environment, registry: { address } },
  };
}

test("oci-registry receives the address and the Service pin derived from it", async () => {
  const repository = await loadRepository("local");
  for (const args of [
    helmUpgradeArgs(repository, component(repository, "oci-registry")),
    helmTemplateArgs(repository, component(repository, "oci-registry")),
  ]) {
    assert.equal(value(args, "platform.registry.address"), "10.96.0.50:5000");
    assert.equal(value(args, "service.clusterIP"), "10.96.0.50");
    assert.equal(value(args, "service.port"), "5000");
  }
});

test("image-policy receives the address and never a Service pin", async () => {
  const repository = await loadRepository("local");
  const args = helmUpgradeArgs(
    repository,
    component(repository, "kore-image-policy"),
  );
  assert.equal(value(args, "platform.registry.address"), "10.96.0.50:5000");
  assert.equal(value(args, "service.clusterIP"), undefined);
});

test("components that do not consume the registry get no registry value", async () => {
  const repository = await loadRepository("local");
  const args = helmUpgradeArgs(
    repository,
    component(repository, "kore-storage"),
  );
  assert.equal(value(args, "platform.registry.address"), undefined);
});

test("a remote hostname registry is passed as an address and pins no Service", async () => {
  const repository = await loadRepository("managed-example");
  const args = helmUpgradeArgs(
    repository,
    component(repository, "kore-image-policy"),
  );
  assert.equal(
    value(args, "platform.registry.address"),
    "registry.example.internal",
  );
  const registry = helmUpgradeArgs(
    repository,
    component(repository, "oci-registry"),
  );
  assert.equal(value(registry, "service.clusterIP"), undefined);
});

test("application releases receive the same platform registry address", async () => {
  const repository = await loadRepository("local");
  const args = releaseArgs(repository, "reference", "reference", "/chart");
  assert.equal(value(args, "platform.registry.address"), "10.96.0.50:5000");
});

test("the image-policy chart renders its glob from the platform address", async () => {
  const repository = await loadRepository("local");
  const template = await readFile(
    join(
      repository.root,
      "infra/charts/image-policy/templates/clusterimagepolicy.yaml",
    ),
    "utf8",
  );
  assert.match(template, /\.Values\.platform\.registry\.address/);
  assert.doesNotMatch(template, /range \.Values\.trust\.images/);
});

test("the registry chart takes the Service port from a value", async () => {
  const repository = await loadRepository("local");
  const template = await readFile(
    join(repository.root, "infra/charts/oci-registry/templates/all.yaml"),
    "utf8",
  );
  assert.match(template, /port: \{\{ \.Values\.service\.port \}\}/);
});

test("changing only registry.address moves every derived consumer", async () => {
  const before = await loadRepository("local");
  const after = await withAddress("local", "10.97.1.9:5000");
  const outputs = (repository: Repository) => ({
    registry: helmUpgradeArgs(
      repository,
      component(repository, "oci-registry"),
    ),
    policy: helmUpgradeArgs(
      repository,
      component(repository, "kore-image-policy"),
    ),
    app: releaseArgs(repository, "reference", "reference", "/chart"),
  });
  const a = outputs(before);
  const b = outputs(after);
  for (const key of ["registry", "policy", "app"] as const) {
    assert.equal(value(a[key], "platform.registry.address"), "10.96.0.50:5000");
    assert.equal(value(b[key], "platform.registry.address"), "10.97.1.9:5000");
  }
  assert.equal(value(b.registry, "service.clusterIP"), "10.97.1.9");
});
