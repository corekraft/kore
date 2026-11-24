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

function withFlag<T extends Awaited<ReturnType<typeof loadRepository>>>(
  repository: T,
  value: boolean,
): T {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [organizationServiceApisFlag]: value,
      },
    },
  };
}

async function read(path: string): Promise<string> {
  return await readFile(join(await findRoot(), path), "utf8");
}

test("local declares the flag on and managed-example declares it off", async () => {
  assert.equal(
    organizationServiceApisFlag,
    "platform-organization-service-apis",
  );
  for (const [name, declared] of [
    ["local", true],
    ["managed-example", false],
  ] as const) {
    const repository = await loadRepository(name);
    assert.equal(
      repository.environment.features?.[organizationServiceApisFlag],
      declared,
      `${name} must declare ${organizationServiceApisFlag} as ${declared}`,
    );
  }
});

test("local installs the Organization and Service APIs and managed-example installs none", async () => {
  for (const [name, installed] of [
    ["local", true],
    ["managed-example", false],
  ] as const) {
    const repository = await loadRepository(name);
    const names = enabledComponents(repository).map((c) => c.name);
    assert.equal(names.includes(component), installed, `${name}: ${component}`);
    assert.ok(
      repository.catalog.components.some((c) => c.name === component),
      "the catalog declares it, gated",
    );
  }
});

test("with the flag turned off in local the render installs no Organization or Service API", async () => {
  const repository = await loadRepository("local");
  const off = withFlag(repository, false);
  assert.ok(!enabledComponents(off).some((c) => c.name === component));
});

test("with the flag on the catalog installs the APIs after Crossplane and its functions", async () => {
  const on = await loadRepository("local");
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

test("Service identifies its organization by a label-safe name of at most 54 characters, and its environments by label-safe names", async () => {
  const xrd = await read(
    "infra/charts/platform-apis/templates/service-xrd.yaml",
  );
  assert.doesNotMatch(xrd, /enum: \[platform\]/);
  assert.match(xrd, /maxLength: 54,/);
  assert.match(xrd, /pattern: "\^\[a-z0-9\]\(\[a-z0-9\]\|-\[a-z0-9\]\)\*\$"/);
  assert.match(xrd, /\^\[a-z0-9\]\(\[-a-z0-9\]\{0,61\}\[a-z0-9\]\)\?\$/);
  assert.match(xrd, /minItems: 1/);
});

test("Organization is accepted only as the platform organization", async () => {
  const xrd = await read(
    "infra/charts/platform-apis/templates/organization-xrd.yaml",
  );
  assert.match(xrd, /self\.metadata\.name == 'platform'/);
});

test("the Organization composition is a skeleton that composes no resource until platform-portal adds the realm", async () => {
  const source = await read(
    "infra/charts/platform-apis/templates/organization-composition.yaml",
  );
  assert.match(source, /^  name: organization-local$/m);
  assert.match(source, /function-auto-ready/);
  assert.doesNotMatch(source, /kind: Namespace/);
  const [always = "", gated = ""] = source.split(
    /^\{\{- if index \$features "platform-portal" \}\}$/m,
  );
  assert.doesNotMatch(always, /function-go-templating/);
  assert.match(gated, /function-go-templating/);
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
  assert.match(source, /name: \{\{ \$service \}\}--\{\{ \$env \}\}/);
  assert.match(source, /composition-resource-name: namespace-\{\{ \$env \}\}/);
  assert.match(source, /platform\.kore\.dev\/tenant: \{\{ \$org \}\}/);
  assert.match(source, /platform\.kore\.dev\/organization: \{\{ \$org \}\}/);
  assert.match(source, /function-auto-ready/);
  assert.doesNotMatch(source, /platform\.kore\.dev\/path/);
});

test("the Service XRD rejects an ambiguous, overlong or reserved namespace name before any mutation", async () => {
  const xrd = await read(
    "infra/charts/platform-apis/templates/service-xrd.yaml",
  );
  // Ambiguous join: the namespace is <service>--<environment>, so neither
  // part may contain a double hyphen (a-b + c must differ from a + b-c).
  assert.match(xrd, /rule: "!self\.metadata\.name\.contains\('--'\)"/);
  assert.match(
    xrd,
    /rule: "self\.spec\.environments\.all\(e, !e\.contains\('--'\)\)"/,
  );
  // Overlong: service + "--" + environment must fit the 63-character limit.
  assert.match(
    xrd,
    /rule: "self\.spec\.environments\.all\(e, self\.metadata\.name\.size\(\) \+ 2 \+ e\.size\(\) <= 63\)"/,
  );
  assert.match(xrd, /namespace name .*at most 63 characters/);
  // Reserved: Kubernetes' kube- and Kore's kore- prefixes. Every composed name
  // contains "--", which no platform namespace (kore-system, crossplane-system,
  // default) does, so these two prefixes are the only remaining collisions.
  assert.match(
    xrd,
    /rule: "!self\.metadata\.name\.startsWith\('kube-'\) && !self\.metadata\.name\.startsWith\('kore-'\)"/,
  );
  assert.match(xrd, /reserved prefix/);
  // Environments are unique and bounded so the rules stay within CEL cost.
  assert.match(xrd, /x-kubernetes-list-type: set/);
  assert.match(xrd, /maxItems: 16/);
});

test("the valid case renders a namespace named service--environment", async () => {
  const source = await read(
    "infra/charts/platform-apis/templates/service-composition.yaml",
  );
  assert.match(source, /name: \{\{ \$service \}\}--\{\{ \$env \}\}/);
  assert.doesNotMatch(source, /\{\{ \$service \}\}-\{\{ \$env \}\}/);
});

test("Crossplane may manage namespaces only through the flagged chart", async () => {
  const rbac = await read(
    "infra/charts/platform-apis/templates/namespace-rbac.yaml",
  );
  assert.match(rbac, /resources: \[namespaces\]/);
  assert.match(rbac, /name: crossplane-platform-namespaces/);
  assert.match(rbac, /name: crossplane\n {4}namespace: crossplane-system/);
});

test("the namespace composition is rendered in local and only while the flag is on", async () => {
  const local = await loadRepository("local");
  const chart = "infra/charts/platform-apis";
  const rendering = (repository: typeof local): string[] =>
    enabledComponents(repository)
      .filter((c) => c.chart === chart)
      .map((c) => c.name);
  assert.deepEqual(rendering(local), [component]);
  assert.deepEqual(rendering(withFlag(local, false)), []);
});
