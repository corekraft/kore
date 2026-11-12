import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";
import {
  loadManagedLocal,
  managedClusterSettings,
} from "./managed-local.fixtures.js";
import { sound, validationMessage } from "./validation.fixtures.js";

test("validation reports invalid versions, component definitions, and missing value files", async () => {
  const base = await loadManagedLocal();
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
        enrollmentExemptions: {},
        name: "BAD_NAME",
        kubeContext: "",
        cluster: { ...managedClusterSettings, cpus: 1, memoryMB: 1 },
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
            ownsCRDs: ["things.shared.example.com"],
          },
          {
            ...component,
            name: "also-bad",
            ownsCRDs: ["things.shared.example.com"],
            dependencies: [],
          },
        ],
      },
    }),
    /semantic version|invalid|must|required|unknown|exist|multiple owners|dependency/i,
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
  const file = "../../../../infra/catalog/schemas/components.schema.json";
  const schema = JSON.parse(
    await readFile(new URL(file, import.meta.url), "utf8"),
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
  // Secret access is bound per namespace by kore app up (ADR 0061).
  assert.deepEqual(readiness("kore-postgresql-rbac"), [
    "clusterrole/crossplane-postgresql-composition",
  ]);
});

test("policy releases prove the objects they apply, not the Gatekeeper controller", async () => {
  const base = await loadRepository("local");
  const readiness = (name: string) =>
    base.catalog.components.find((component) => component.name === name)
      ?.readiness ?? [];
  assert.ok(
    !readiness("kore-policy-constraints").some((r) =>
      r.startsWith("deployment/"),
    ),
  );
  assert.deepEqual(readiness("kore-policy-constraints"), [
    "korecontainersecurity.constraints.gatekeeper.sh/kore-container-security",
    "koreimagedigest.constraints.gatekeeper.sh/kore-image-digest",
    "koremeshenrollment.constraints.gatekeeper.sh/kore-mesh-enrollment",
    "korerbac.constraints.gatekeeper.sh/kore-rbac",
    "koreretention.constraints.gatekeeper.sh/kore-retention",
    "koresecrets.constraints.gatekeeper.sh/kore-secrets",
    "koreworkloadidentity.constraints.gatekeeper.sh/kore-workload-identity",
  ]);
  for (const name of [
    "korecontainersecurity",
    "koreimagedigest",
    "koremeshenrollment",
    "korerbac",
    "koreretention",
    "koresecrets",
    "koreworkloadidentity",
  ]) {
    assert.ok(
      readiness("kore-policy-templates").includes(
        `constrainttemplate.templates.gatekeeper.sh/${name}`,
      ),
    );
  }
});

test("validation rejects ownsCRDs entries that are not <plural>.<group>", async () => {
  const message = await validationMessage((base) => ({
    ...base,
    catalog: {
      components: [{ ...sound, name: "odd", ownsCRDs: ["shared.example"] }],
    },
  }));
  assert.match(
    message,
    /odd: ownsCRDs entry shared\.example must look like <plural>\.<group>/,
  );
});

test("an environment source must be a manifest component's existing directory", async () => {
  const message = await validationMessage((base) => ({
    ...base,
    environment: {
      ...base.environment,
      componentSources: {
        "kore-crossplane-functions": "infra/missing-dir",
        loki: "infra/apis",
      },
    },
  }));
  assert.match(
    message,
    /kore-crossplane-functions: environment source does not exist: infra\/missing-dir/,
  );
  assert.match(
    message,
    /environment component source for a non-manifest component: loki/,
  );
});
