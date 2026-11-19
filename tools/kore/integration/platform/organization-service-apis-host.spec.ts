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
} from "../../src/config/index.js";

// Docs: docs/decisions/0042-organization-domains-by-delegation.md

const component = "kore-platform-apis";

async function read(path: string): Promise<string> {
  return await readFile(join(await findRoot(), path), "utf8");
}

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

test("each environment overlay supplies its own platform domain and the chart has no default", async () => {
  await assert.rejects(
    read("infra/charts/platform-apis/values.yaml"),
    /ENOENT/,
    "a chart default would give a non-local environment the local domain",
  );
  for (const [name, domain] of [
    ["local", "kore.local"],
    ["managed-example", "platform.example.com"],
  ] as const) {
    const repository = await loadRepository(name);
    const files = repository.environment.componentValues?.[component] ?? [];
    assert.deepEqual(files, [
      `infra/environments/${name}/values/platform-apis.yaml`,
    ]);
    const values = await read(files[0]!);
    assert.match(
      values,
      new RegExp(`^platformDomain: ${domain.replace(/\./g, "\\.")}$`, "m"),
    );
  }
  await assert.rejects(
    helmRender(),
    /platformDomain/,
    "omitting it fails the schema",
  );
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
  assert.deepEqual(hostCharts(local), [component], "flag on: it renders");
  const off = {
    ...local,
    environment: {
      ...local.environment,
      features: {
        ...local.environment.features,
        [organizationServiceApisFlag]: false,
      },
    },
  };
  assert.deepEqual(hostCharts(off), [], "flag off: no composition renders");
});
