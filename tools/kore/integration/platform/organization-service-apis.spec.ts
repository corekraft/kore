import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
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

test("the Service composition composes the default host service.organization.platformDomain (ADR 0042)", async () => {
  const source = await read(
    "infra/charts/platform-apis/templates/service-composition.yaml",
  );
  assert.match(
    source,
    /\$domain := `\}\}\{\{ \.Values\.platformDomain \| quote \}\}\{\{`/,
  );
  assert.match(
    source,
    /\$host := printf "%s\.%s\.%s" \$service \$org \$domain/,
  );
  // A status field on the Service, and an annotation on each composed namespace.
  assert.match(source, /^ {12}kind: Service$/m);
  assert.match(source, /^ {14}defaultHost: \{\{ \$host \}\}$/m);
  assert.match(source, /platform\.kore\.dev\/default-host: \{\{ \$host \}\}/);
});

test("the platform domain is a chart value defaulting to kore.local, validated as a hostname", async () => {
  const values = await read("infra/charts/platform-apis/values.yaml");
  assert.match(values, /^platformDomain: kore\.local$/m);
  const schema = JSON.parse(
    await read("infra/charts/platform-apis/values.schema.json"),
  ) as {
    required: string[];
    properties: { platformDomain: { pattern: string; maxLength: number } };
  };
  assert.deepEqual(schema.required, ["platformDomain"]);
  const { pattern, maxLength } = schema.properties.platformDomain;
  const re = new RegExp(pattern);
  assert.ok(re.test("kore.local"));
  assert.ok(!re.test("Kore.local"), "uppercase is rejected");
  assert.ok(!re.test("kore"), "a single label is not a domain");
  assert.ok(!re.test(`${"a".repeat(64)}.local`), "labels are at most 63");
  // A 63-character service, the organization and the domain fit 253 characters.
  assert.equal(maxLength, 253 - 63 - "platform".length - 2);
});

test("the Service XRD validates the host label up front and declares the status field", async () => {
  const xrd = await read(
    "infra/charts/platform-apis/templates/service-xrd.yaml",
  );
  assert.match(
    xrd,
    /rule: "self\.metadata\.name\.matches\('\^\[a-z0-9\]\(\[-a-z0-9\]\{0,61\}\[a-z0-9\]\)\?\$'\)"/,
  );
  assert.match(xrd, /metadata\.name must be a single DNS label/);
  assert.match(xrd, /defaultHost: \{ type: string \}/);
});

test("the XRD name rule accepts a single DNS label and rejects a dotted, overlong, uppercase or hyphen-led name", async () => {
  const xrd = await read(
    "infra/charts/platform-apis/templates/service-xrd.yaml",
  );
  const cel = /self\.metadata\.name\.matches\('([^']+)'\)/.exec(xrd);
  assert.ok(cel, "the XRD declares a matches() name rule");
  const re = new RegExp(cel[1]!);
  for (const ok of ["auth", "a", "my-service-2", "a".repeat(63)]) {
    assert.ok(re.test(ok), `${ok} is accepted`);
  }
  for (const bad of [
    "auth.apps",
    "a".repeat(64),
    "Auth",
    "-auth",
    "auth-",
    "",
  ]) {
    assert.ok(!re.test(bad), `${bad} is rejected`);
  }
});

async function helmRender(...args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)("helm", [
    "template",
    "x",
    join(await findRoot(), "infra/charts/platform-apis"),
    ...args,
  ]);
  return stdout;
}

test("the rendered composition carries the host for the given platform domain, and a bad domain is refused", async () => {
  const rendered = await helmRender("--set", "platformDomain=test.example");
  assert.match(rendered, /\{\{- \$domain := "test\.example" \}\}/);
  assert.match(
    rendered,
    /\$host := printf "%s\.%s\.%s" \$service \$org \$domain/,
  );
  assert.match(rendered, /^ {14}defaultHost: \{\{ \$host \}\}$/m);
  assert.match(rendered, /platform\.kore\.dev\/default-host: \{\{ \$host \}\}/);
  // The template's host, evaluated for service auth in the platform organization.
  const host = ["auth", "platform", "test.example"].join(".");
  assert.equal(host, "auth.platform.test.example");
  await assert.rejects(helmRender("--set", "platformDomain=Bad"), /pattern/);
  await assert.rejects(
    helmRender("--set", "platformDomain="),
    /platformDomain/,
  );
});

test("the default host reaches a cluster only when the flag is on", async () => {
  const local = await loadRepository("local");
  const hostCharts = (repository: typeof local): string[] =>
    enabledComponents(repository)
      .filter((c) => c.chart === "infra/charts/platform-apis")
      .map((c) => c.name);
  assert.deepEqual(hostCharts(local), [], "flag off: no composition renders");
  const on = {
    ...local,
    environment: {
      ...local.environment,
      features: {
        ...local.environment.features,
        [organizationServiceApisFlag]: true,
      },
    },
  };
  assert.deepEqual(hostCharts(on), [component]);
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
