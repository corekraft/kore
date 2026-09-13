import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository, orderedComponents, validateRepository, type Catalog } from "./config.js";

test("repository catalogs and local environment validate", async () => {
  const root = await findRoot(); const repository = await loadRepository("local",root); const order = orderedComponents(repository.catalog);
  assert.equal(order.length,repository.catalog.components.length);
  const positions = new Map(order.map((component,index) => [component.name,index]));
  for (const component of order) for (const dependency of component.dependencies) assert.ok(positions.get(dependency)! < positions.get(component.name)!);
});

test("cycle detection reports every blocked component", () => {
  const catalog: Catalog = { components:[
    {name:"a",phase:"core",namespace:"a",kind:"helm",chart:"a",version:"local",ownsCRDs:[],dependencies:["b"],timeout:"1m",readiness:[]},
    {name:"b",phase:"core",namespace:"b",kind:"helm",chart:"b",version:"local",ownsCRDs:[],dependencies:["a"],timeout:"1m",readiness:[]},
  ]};
  assert.throws(() => orderedComponents(catalog),/a, b/);
});

test("malformed environment fails with useful schema errors", async () => {
  const root = await mkdtemp(join(tmpdir(),"kore-test-"));
  await mkdir(join(root,"infra/catalog"),{recursive:true}); await mkdir(join(root,"infra/environments/bad"),{recursive:true});
  await writeFile(join(root,"infra/catalog/versions.yaml"),`{"tools":{},"kubernetes":"1.35.1","components":{},"images":{}}`);
  await writeFile(join(root,"infra/catalog/components.yaml"),`{"components":[]}`);
  await writeFile(join(root,"infra/environments/bad/environment.yaml"),`{"name":"BAD","provider":"invalid","cluster":{"cpus":1,"memoryMB":1}}`);
  await assert.rejects(loadRepository("bad",root),/environment.name is invalid/);
});

test("missing catalog sections fail as schema errors instead of TypeError", async () => {
  const root = await mkdtemp(join(tmpdir(),"kore-schema-"));
  await mkdir(join(root,"infra/catalog"),{recursive:true}); await mkdir(join(root,"infra/environments/local"),{recursive:true});
  await writeFile(join(root,"infra/catalog/versions.yaml"),`{}`); await writeFile(join(root,"infra/catalog/components.yaml"),`{}`);
  await writeFile(join(root,"infra/environments/local/environment.yaml"),`{}`);
  await assert.rejects(loadRepository("local",root),/schema|kubernetes|environment/i);
});

test("environment overlays reject unknown component names", async () => {
  const repository = await loadRepository("local");
  await assert.rejects(
    validateRepository({ ...repository, environment: { ...repository.environment, componentValues: { unknown: ["infra/observability/collector/values.yaml"] } } }),
    /unknown environment component values.*unknown/i,
  );
});

test("local catalog pins an available Istio chart release", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.versions.components.istio, "1.30.4");
  assert.equal(repository.versions.components["opentelemetry-operator"], "0.122.0");
  assert.equal(repository.versions.components.prometheus, "27.52.0");
});
