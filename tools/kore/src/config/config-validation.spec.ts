import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";

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

const sound = {
  phase: "core" as const,
  namespace: "ns",
  kind: "helm" as const,
  chart: "chart",
  version: "local",
  ownsCRDs: [] as string[],
  dependencies: [] as string[],
  timeout: "1m",
  readiness: ["deployment/sound"],
};

async function validationMessage(
  mutate: (base: Awaited<ReturnType<typeof loadRepository>>) => unknown,
): Promise<string> {
  const base = await loadRepository("local");
  try {
    await validateRepository(mutate(base) as typeof base);
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

test("validation reports every rule violation exactly once, sorted", async () => {
  const message = await validationMessage((base) => ({
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
      provider: "other",
      kubeContext: "",
      cluster: { ...base.environment.cluster, cpus: 1, memoryMB: 1 },
      componentValues: { "also-bad": ["missing-env.yaml"], ghost: [] },
    },
    catalog: {
      components: [
        {
          ...sound,
          name: "BAD_NAME",
          phase: "x",
          kind: "x",
          namespace: "",
          timeout: "0m",
          version: "unknown",
          chart: undefined,
          values: ["missing.yaml"],
          dependencies: ["missing-dependency"],
          ownsCRDs: ["shared.example.com"],
        },
        { ...sound, name: "also-bad", ownsCRDs: ["shared.example.com"] },
        { ...sound, name: "also-bad", kind: "manifest", chart: undefined },
        { ...sound, name: "cyc-a", dependencies: ["cyc-b"] },
        { ...sound, name: "cyc-b", dependencies: ["cyc-a"] },
      ],
    },
  }));
  assert.equal(
    message,
    [
      "BAD_NAME: chart is required",
      "BAD_NAME: invalid kind",
      "BAD_NAME: invalid phase",
      "BAD_NAME: namespace and bounded timeout are required",
      "BAD_NAME: unknown dependency missing-dependency",
      "BAD_NAME: unknown version key unknown",
      "BAD_NAME: values file does not exist: missing.yaml",
      "CRD shared.example.com has multiple owners: BAD_NAME and also-bad",
      "also-bad: environment values file does not exist: missing-env.yaml",
      "also-bad: manifest source is required",
      "component has invalid name: BAD_NAME",
      "components.invalid must be an exact semantic version",
      "duplicate component: also-bad",
      "environment.cluster.cpus must be at least 2",
      "environment.cluster.memoryMB must be at least 4096",
      "environment.kubeContext is required",
      "environment.name is invalid",
      "environment.provider must be minikube or managed",
      "release dependency cycle includes: BAD_NAME, cyc-a, cyc-b",
      "tools.broken must be an exact semantic version",
      "unknown environment component values: ghost",
      "versions.kubernetes must be an exact semantic version",
    ].join("\n"),
  );
});

test("validation reports malformed version sections and missing sections", async () => {
  const message = await validationMessage((base) => ({
    ...base,
    versions: { kubernetes: "", images: {} },
    environment: { ...base.environment, cluster: undefined },
    catalog: {},
  }));
  assert.equal(
    message,
    [
      "Cannot read properties of undefined (reading 'map')",
      "environment.cluster.cpus must be at least 2",
      "environment.cluster.memoryMB must be at least 4096",
      "unknown environment component values: grafana",
      "unknown environment component values: kore-local-tls",
      "unknown environment component values: kore-platform-config",
      "unknown environment component values: loki",
      "unknown environment component values: otel-agent",
      "unknown environment component values: otel-collector",
      "unknown environment component values: prometheus",
      "unknown environment component values: tempo",
      "versions.components must be an object of pinned versions",
      "versions.kubernetes must be an exact semantic version",
      "versions.tools must be an object of pinned versions",
    ].join("\n"),
  );
});

test("validation accepts a sound repository", async () => {
  assert.equal(await validationMessage((base) => base), "");
});

test("a component with no readiness check fails validation naming the component", async () => {
  const message = await validationMessage((base) => ({
    ...base,
    catalog: {
      components: [{ ...sound, name: "unchecked", readiness: [] }],
    },
  }));
  assert.match(message, /unchecked: at least one readiness check is required/);
});

test("every catalog component declares at least one readiness check", async () => {
  const base = await loadRepository("local");
  const unchecked = base.catalog.components
    .filter(({ readiness }) => readiness.length === 0)
    .map(({ name }) => name);
  assert.deepEqual(unchecked, []);
});

test("the components schema requires at least one readiness check", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../../../../infra/catalog/schemas/components.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    schema.properties.components.items.properties.readiness.minItems,
    1,
  );
});

test("storage and PostgreSQL RBAC releases prove the resources they own", async () => {
  const base = await loadRepository("local");
  const readiness = (name: string) =>
    base.catalog.components.find((component) => component.name === name)
      ?.readiness;
  assert.deepEqual(readiness("kore-storage"), [
    "storageclass/kore-standard",
    "storageclass/kore-retained",
  ]);
  assert.deepEqual(readiness("kore-postgresql-rbac"), [
    "clusterrole/crossplane-postgresql-composition",
    "clusterrolebinding/crossplane-postgresql-composition",
  ]);
});
