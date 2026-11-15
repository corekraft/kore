import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import {
  enabledComponents,
  findRoot,
  loadRepository,
  organizationServiceApisFlag,
  validateRepository,
} from "../../src/config/index.js";

// Docs: docs/decisions/0008-crossplane-postgresql-platform-api.md

const component = "kore-platform-apis";

async function read(path: string): Promise<string> {
  return await readFile(join(await findRoot(), path), "utf8");
}

test("the flag is declared off in every environment overlay", async () => {
  assert.equal(
    organizationServiceApisFlag,
    "platform-organization-service-apis",
  );
  for (const name of ["local", "managed-example"]) {
    const repository = await loadRepository(name);
    assert.equal(
      repository.environment.features?.[organizationServiceApisFlag],
      false,
      `${name} must declare ${organizationServiceApisFlag} as false`,
    );
  }
});

test("with the flag off the render installs no Organization or Service API", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = await loadRepository(name);
    const names = enabledComponents(repository).map((c) => c.name);
    assert.ok(!names.includes(component), `${name} must not install it`);
    assert.ok(
      repository.catalog.components.some((c) => c.name === component),
      "the catalog declares it, gated",
    );
  }
});

test("with the flag on the catalog installs the APIs after Crossplane and its functions", async () => {
  const repository = await loadRepository("local");
  const on = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [organizationServiceApisFlag]: true,
      },
    },
  };
  await validateRepository(on);
  const names = enabledComponents(on).map((c) => c.name);
  assert.ok(names.includes(component));
  assert.ok(
    names.indexOf(component) > names.indexOf("kore-crossplane-functions"),
  );
  const gated = on.catalog.components.find((c) => c.name === component)!;
  assert.equal(gated.featureFlag, organizationServiceApisFlag);
  assert.equal(gated.chart, "infra/charts/platform-apis");
  assert.deepEqual(gated.ownsCRDs, [
    "organizations.platform.kore.dev",
    "services.platform.kore.dev",
  ]);
});

test("both XRDs follow the PostgreSQL API layout in the platform.kore.dev group", async () => {
  for (const [file, kind, plural] of [
    ["organization", "Organization", "organizations"],
    ["service", "Service", "services"],
  ] as const) {
    const xrd = await read(
      `infra/charts/platform-apis/templates/${file}-xrd.yaml`,
    );
    assert.match(xrd, /^kind: CompositeResourceDefinition$/m);
    assert.match(
      xrd,
      new RegExp(`^  name: ${plural}\\.platform\\.kore\\.dev$`, "m"),
    );
    assert.match(xrd, /^  group: platform\.kore\.dev$/m);
    assert.match(xrd, new RegExp(`^    kind: ${kind}$`, "m"));
    assert.match(
      xrd,
      new RegExp(`^  defaultCompositionRef:\\n    name: ${file}-local$`, "m"),
    );
    assert.match(xrd, /^    - name: v1alpha1$/m);
  }
});

test("Service identifies its organization and environments by label-safe names, platform only", async () => {
  const xrd = await read(
    "infra/charts/platform-apis/templates/service-xrd.yaml",
  );
  assert.match(xrd, /organization: \{ type: string, enum: \[platform\] \}/);
  assert.match(xrd, /\^\[a-z0-9\]\(\[-a-z0-9\]\{0,61\}\[a-z0-9\]\)\?\$/);
  assert.match(xrd, /minItems: 1/);
});

test("Organization is accepted only as the platform organization", async () => {
  const xrd = await read(
    "infra/charts/platform-apis/templates/organization-xrd.yaml",
  );
  assert.match(xrd, /self\.metadata\.name == 'platform'/);
});

test("the Organization composition is still a skeleton that composes no resource", async () => {
  const source = await read(
    "infra/charts/platform-apis/templates/organization-composition.yaml",
  );
  assert.match(source, /^  name: organization-local$/m);
  assert.match(source, /function-auto-ready/);
  assert.doesNotMatch(source, /kind: Namespace/);
  assert.doesNotMatch(source, /function-go-templating/);
});

test("the Service composition composes one labelled namespace per environment", async () => {
  const source = await read(
    "infra/charts/platform-apis/templates/service-composition.yaml",
  );
  assert.match(source, /^  name: service-local$/m);
  assert.match(source, /kind: Service \}/);
  assert.match(source, /mode: Pipeline/);
  assert.match(source, /functionRef: \{ name: function-go-templating \}/);
  assert.match(
    source,
    /range \$env := \.observed\.composite\.resource\.spec\.environments/,
  );
  assert.match(source, /^ {12}kind: Namespace$/m);
  assert.match(source, /name: \{\{ \$service \}\}-\{\{ \$env \}\}/);
  assert.match(source, /composition-resource-name: namespace-\{\{ \$env \}\}/);
  assert.match(source, /platform\.kore\.dev\/tenant: \{\{ \$org \}\}/);
  assert.match(source, /platform\.kore\.dev\/organization: \{\{ \$org \}\}/);
  assert.match(source, /function-auto-ready/);
  assert.doesNotMatch(source, /platform\.kore\.dev\/path/);
});

test("Crossplane may manage namespaces only through the flagged chart", async () => {
  const rbac = await read(
    "infra/charts/platform-apis/templates/namespace-rbac.yaml",
  );
  assert.match(rbac, /resources: \[namespaces\]/);
  assert.match(rbac, /name: crossplane-platform-namespaces/);
  assert.match(rbac, /name: crossplane\n {4}namespace: crossplane-system/);
});

test("the namespace composition is rendered only when the flag is on", async () => {
  const local = await loadRepository("local");
  const chart = "infra/charts/platform-apis";
  const rendering = (repository: typeof local): string[] =>
    enabledComponents(repository)
      .filter((c) => c.chart === chart)
      .map((c) => c.name);
  assert.deepEqual(rendering(local), []);
  assert.deepEqual(
    rendering({
      ...local,
      environment: {
        ...local.environment,
        features: {
          ...local.environment.features,
          [organizationServiceApisFlag]: true,
        },
      },
    }),
    [component],
  );
});
