import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "./config.js";

const bundleFiles = [".manifest", "mask.rego", "policy.rego"];

async function read(...parts: string[]): Promise<string> {
  return readFile(join(await findRoot(), ...parts), "utf8");
}

const template = () => read("infra/charts/opa-authorizer/templates/all.yaml");

test("deployed policy is the tested bundle: chart copy matches bundles/v1", async () => {
  const root = await findRoot();
  const source = join(root, "infra/policies/opa/bundles/v1");
  const copy = join(root, "infra/charts/opa-authorizer/bundle");
  const deployable = (await readdir(source, { withFileTypes: true }))
    .filter((e) => e.isFile() && !e.name.endsWith(".spec.rego"))
    .map((e) => e.name)
    .sort();
  assert.deepEqual(deployable, bundleFiles);
  assert.deepEqual((await readdir(copy)).sort(), bundleFiles);
  for (const name of bundleFiles) {
    assert.equal(
      await readFile(join(copy, name), "utf8"),
      await readFile(join(source, name), "utf8"),
      `${name} drifted; copy infra/policies/opa/bundles/v1/${name} into the chart bundle/ directory`,
    );
  }
});

test("authorizer loads the chart bundle and carries no inline Rego", async () => {
  const text = await template();
  assert.match(text, /- --bundle\n\s+- \/bundle\n/);
  assert.match(text, /\.Files\.Get "bundle\/policy\.rego"/);
  assert.match(text, /\.Files\.Get "bundle\/\.manifest"/);
  assert.doesNotMatch(text, /package envoy\.authz/);
  assert.doesNotMatch(text, /- \/policies/);
});

test("pods restart when the bundle changes", async () => {
  assert.match(await template(), /checksum\/bundle:/);
});

test("decision logs go to the console with the masking policy enabled", async () => {
  const text = await template();
  assert.match(text, /--set=decision_logs\.console=true/);
  const manifest = JSON.parse(
    await read("infra/policies/opa/bundles/v1/.manifest"),
  ) as {
    roots: string[];
  };
  assert.ok(manifest.roots.includes("system/log"));
});

test("values carry no unused bundle delivery settings", async () => {
  const values = await read("infra/charts/opa-authorizer/values.yaml");
  assert.doesNotMatch(values, /bundle/);
});

test("authorizer failure fails closed for the protected route", async () => {
  const root = await findRoot();
  const istiod = await read("infra/environments/common/values/istiod.yaml");
  assert.match(
    istiod,
    /name: opa-authorizer\n\s+envoyExtAuthzGrpc:[\s\S]*?failOpen: false/,
  );
  assert.doesNotMatch(istiod, /failOpen: true/);
  const workloads = await readFile(
    join(root, "apps/reference/charts/workload/templates/workloads.yaml"),
    "utf8",
  );
  assert.match(
    workloads,
    /action: CUSTOM\n\s+provider: \{name: opa-authorizer\}/,
  );
  assert.match(workloads, /paths: \["\/api\/protected"\]/);
});
