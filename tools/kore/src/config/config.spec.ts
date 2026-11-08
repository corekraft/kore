import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  absolute,
  componentValues,
  componentVersion,
  expandVersions,
  findRoot,
  loadRepository,
  orderedComponents,
  validateRepository,
  type Catalog,
} from "./config.js";

test("repository catalogs and local environment validate", async () => {
  const root = await findRoot();
  const repository = await loadRepository("local", root);
  const order = orderedComponents(repository.catalog);
  assert.equal(order.length, repository.catalog.components.length);
  const positions = new Map(
    order.map((component, index) => [component.name, index]),
  );
  for (const component of order)
    for (const dependency of component.dependencies)
      assert.ok(positions.get(dependency)! < positions.get(component.name)!);
});

test("cycle detection reports every blocked component", () => {
  const catalog: Catalog = {
    components: [
      {
        name: "a",
        phase: "core",
        namespace: "a",
        kind: "helm",
        chart: "a",
        version: "local",
        ownsCRDs: [],
        dependencies: ["b"],
        timeout: "1m",
        readiness: [],
      },
      {
        name: "b",
        phase: "core",
        namespace: "b",
        kind: "helm",
        chart: "b",
        version: "local",
        ownsCRDs: [],
        dependencies: ["a"],
        timeout: "1m",
        readiness: [],
      },
    ],
  };
  assert.throws(() => orderedComponents(catalog), /a, b/);
});

test("release ordering places earlier infrastructure phases before later phases", () => {
  const catalog: Catalog = {
    components: [
      {
        name: "a-core-release",
        phase: "core",
        namespace: "core",
        kind: "helm",
        chart: "core",
        version: "local",
        ownsCRDs: [],
        dependencies: [],
        timeout: "1m",
        readiness: [],
      },
      {
        name: "z-bootstrap-release",
        phase: "bootstrap",
        namespace: "bootstrap",
        kind: "helm",
        chart: "bootstrap",
        version: "local",
        ownsCRDs: [],
        dependencies: [],
        timeout: "1m",
        readiness: [],
      },
    ],
  };

  assert.deepEqual(
    orderedComponents(catalog).map(({ name }) => name),
    ["z-bootstrap-release", "a-core-release"],
  );
});

test("malformed environment fails with useful schema errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-test-"));
  await mkdir(join(root, "infra/catalog"), { recursive: true });
  await mkdir(join(root, "infra/environments/bad"), { recursive: true });
  await writeFile(
    join(root, "infra/catalog/versions.yaml"),
    `{"tools":{},"kubernetes":"1.35.1","components":{},"images":{}}`,
  );
  await writeFile(
    join(root, "infra/catalog/components.yaml"),
    `{"components":[]}`,
  );
  await writeFile(
    join(root, "infra/environments/bad/environment.yaml"),
    `{"name":"BAD","provider":"invalid","cluster":{"cpus":1,"memoryMB":1}}`,
  );
  await assert.rejects(
    loadRepository("bad", root),
    /environment.name is invalid/,
  );
});

test("missing catalog sections fail as schema errors instead of TypeError", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-schema-"));
  await mkdir(join(root, "infra/catalog"), { recursive: true });
  await mkdir(join(root, "infra/environments/local"), { recursive: true });
  await writeFile(join(root, "infra/catalog/versions.yaml"), `{}`);
  await writeFile(join(root, "infra/catalog/components.yaml"), `{}`);
  await writeFile(
    join(root, "infra/environments/local/environment.yaml"),
    `{}`,
  );
  await assert.rejects(
    loadRepository("local", root),
    /schema|kubernetes|environment/i,
  );
});

test("environment overlays reject unknown component names", async () => {
  const repository = await loadRepository("local");
  await assert.rejects(
    validateRepository({
      ...repository,
      environment: {
        ...repository.environment,
        componentValues: {
          unknown: ["infra/observability/collector/values.yaml"],
        },
      },
    }),
    /unknown environment component values.*unknown/i,
  );
});

test("repository toolchain pins are declared in the local mise profile", async () => {
  const root = await findRoot();
  const mise = await readFile(join(root, ".mise.toml"), "utf8");
  for (const pin of [
    'node = "26.13.0"',
    'npm = "12.2.2"',
    'minikube = "1.39.0"',
    'kubectl = "1.37.2"',
    'helm = "4.3.1"',
    'yq = "4.54.2"',
    'sops = "3.13.3"',
    'age = "1.3.2"',
    'mkcert = "1.4.4"',
    'opa = "1.22.2"',
    'tofu = "1.13.9"',
    'cosign = "3.1.4"',
  ]) {
    assert.match(mise, new RegExp(pin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("the repository tool catalog pins Cosign for image verification", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.versions.tools.cosign, "3.1.4");
});

test("local catalog pins an available Istio chart release", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.versions.components.istio, "1.30.4");
  assert.equal(
    repository.versions.components["opentelemetry-operator"],
    "0.122.0",
  );
  assert.equal(repository.versions.components.prometheus, "29.29.0");
});

test("component helpers resolve local and pinned versions and combine value files", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components[0]!;
  assert.equal(
    componentVersion(repository, { ...component, version: "local" }),
    undefined,
  );
  assert.equal(
    componentVersion(repository, {
      ...component,
      version: "istio",
    }),
    repository.versions.components.istio?.replace(/^v/, ""),
  );
  assert.equal(
    componentVersion(repository, { ...component, version: "missing-version" }),
    undefined,
  );
  assert.deepEqual(
    componentValues(
      {
        ...repository,
        environment: {
          ...repository.environment,
          componentValues: { [component.name]: ["environment.yaml"] },
        },
      },
      { ...component, values: ["base.yaml"] },
    ),
    ["base.yaml", "environment.yaml"],
  );
  assert.deepEqual(
    componentValues(repository, { ...component, values: [] }),
    [],
  );
  assert.equal(
    absolute(repository, "/tmp/external.yaml"),
    "/tmp/external.yaml",
  );
  assert.equal(
    absolute(repository, "relative.yaml"),
    join(repository.root, "relative.yaml"),
  );
  assert.equal(
    expandVersions(repository, "${istio} ${not-defined}"),
    `${repository.versions.components.istio?.replace(/^v/, "")} \${not-defined}`,
  );
});

test("validation reports invalid versions, component definitions, and missing value files", async () => {
  const base = await loadRepository("local");
  const component = base.catalog.components[0]!;
  const { chart: _chart, ...withoutChart } = component;
  await assert.rejects(
    validateRepository({
      ...base,
      versions: {
        ...base.versions,
        kubernetes: "latest",
        tools: { broken: "main" },
        components: { invalid: "1" },
      },
      environment: {
        ...base.environment,
        name: "BAD_NAME",
        kubeContext: "",
        cluster: { ...base.environment.cluster, cpus: 1, memoryMB: 1 },
        componentValues: { [component.name]: ["missing-env.yaml"] },
      },
      catalog: {
        components: [
          {
            ...withoutChart,
            name: "BAD_NAME",
            phase: "invalid" as never,
            kind: "invalid" as never,
            namespace: "",
            timeout: "0m",
            version: "unknown",
            values: ["missing.yaml"],
            dependencies: ["missing-dependency"],
            ownsCRDs: ["shared.example.com"],
          },
          {
            ...component,
            name: "also-bad",
            ownsCRDs: ["shared.example.com"],
            dependencies: [],
          },
        ],
      },
    }),
    /semantic version|invalid|must|required|unknown|exist|multiple owners|dependency/i,
  );
});

test("local tool catalog matches the supported Docker CLI line", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.versions.tools.docker, "29.7.2");
});
