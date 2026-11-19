import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import {
  componentValues,
  loadRepository,
  platformHelmArgs,
  platformPlan,
  validateRepository,
  type Repository,
} from "../../src/config/index.js";
import { helmTemplateArgs, routeHostErrors } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";

// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// The platform domain is written once, in the environment's platform field.
// These specs render the real charts to prove every copy follows it, and that
// every route host on the platform Gateway has a listener hostname that serves
// it, without a cluster.

const derived = [
  "kore-platform-apis",
  "kore-platform-keycloak",
  "kore-platform-config",
  "kore-local-tls",
] as const;

function render(repository: Repository, name: string): string {
  const component = repository.catalog.components.find((c) => c.name === name);
  assert.ok(component, `${name} is in the catalog`);
  return execFileSync(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    { cwd: repository.root, encoding: "utf8" },
  );
}

// The Backstage chart's schema is closed to the feature flags kore passes the
// other charts, so it renders from its value files and the derived domain.
function renderBackstage(repository: Repository): string {
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-backstage",
  );
  assert.ok(component, "kore-platform-backstage is in the catalog");
  return execFileSync(
    "helm",
    [
      "template",
      "kore-platform-backstage",
      join(repository.root, "infra/charts/platform-backstage"),
      "--namespace",
      "backstage",
      ...componentValues(repository, component).flatMap((file) => [
        "--values",
        join(repository.root, file),
      ]),
      ...platformHelmArgs(repository.environment, component.name),
    ],
    { cwd: repository.root, encoding: "utf8" },
  );
}

function renderReferenceRoute(repository: Repository, host: string): string {
  const { gateway } = repository.environment;
  return execFileSync(
    "helm",
    [
      "template",
      "reference",
      join(repository.root, "apps/reference/charts/workload"),
      "--namespace",
      "reference",
      "--set-string",
      `platform.gateway.name=${gateway.name}`,
      "--set-string",
      `platform.gateway.namespace=${gateway.namespace}`,
      "--set-string",
      `platform.gateway.hostname=${host}`,
    ],
    { cwd: repository.root, encoding: "utf8" },
  );
}

test("the defaults are kore.local and platform, so rendering is unchanged", async () => {
  const repository = await loadRepository("local");
  assert.deepEqual(platformPlan(repository.environment), {
    domain: "kore.local",
    organizationId: "platform",
  });
});

test("every chart that names the platform domain renders the environment's field, and an environment with another domain renders that instead", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = await loadRepository(name);
    const { domain } = platformPlan(repository.environment);
    for (const component of derived) {
      const rendered = render(repository, component);
      assert.ok(
        rendered.includes(domain),
        `${name} ${component} renders ${domain}`,
      );
    }
    assert.ok(renderBackstage(repository).includes(domain));
  }
  const local = await loadRepository("local");
  const moved: Repository = {
    ...local,
    environment: {
      ...local.environment,
      platform: { domain: "moved.example", organizationId: "platform" },
    },
  };
  for (const component of derived) {
    const rendered = render(moved, component);
    assert.doesNotMatch(
      rendered,
      /kore\.local/,
      `${component} keeps no copy of the local domain`,
    );
    assert.ok(rendered.includes("moved.example"));
  }
  assert.doesNotMatch(renderBackstage(moved), /kore\.local/);
  assert.ok(renderBackstage(moved).includes("backstage.moved.example"));
}, 30_000);

test("a malformed platform field is refused by validation before any chart renders", async () => {
  const local = await loadRepository("local");
  for (const platform of [
    { domain: "Kore.Local", organizationId: "platform" },
    { domain: "kore", organizationId: "platform" },
    { domain: "kore.local", organizationId: "Platform" },
  ]) {
    await assert.rejects(
      validateRepository({
        ...local,
        environment: { ...local.environment, platform },
      }),
      /platform\.(domain|organizationId) must be/,
    );
  }
});

test("no overlay values file and no chart default carries a copy of the platform domain", async () => {
  const { root } = await loadRepository("local");
  const copies = [
    ...["local", "managed-example"].map((name) =>
      join(root, "infra/environments", name, "values/platform-config.yaml"),
    ),
    ...[
      "platform-apis",
      "platform-backstage",
      "platform-certificate",
      "platform-config",
      "platform-keycloak",
    ].map((chart) => join(root, "infra/charts", chart, "values.yaml")),
  ];
  for (const file of copies) {
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    assert.doesNotMatch(
      text,
      /^\s*(?:platformDomain:|hostname:)|\{\s*hostname:/m,
      `${file} must not set the platform domain; platform.domain in the environment is the one source`,
    );
  }
});

test("every route host on the platform Gateway has a listener hostname that serves it", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = await loadRepository(name);
    const { domain } = platformPlan(repository.environment);
    const rendered = [
      render(repository, "kore-platform-config"),
      renderReferenceRoute(repository, domain),
    ].join("\n---\n");
    assert.deepEqual(
      routeHostErrors(rendered, repository.environment.gateway),
      [],
    );
  }
});

test("a route host the platform Gateway has no listener for fails the check, naming the host", async () => {
  const repository = await loadRepository("local");
  const rendered = [
    render(repository, "kore-platform-config"),
    renderReferenceRoute(repository, "moved.kore.internal"),
  ].join("\n---\n");
  const errors = routeHostErrors(rendered, repository.environment.gateway);
  assert.equal(errors.length, 1);
  assert.match(
    errors[0]!,
    /^HTTPRoute reference host moved\.kore\.internal matches no listener hostname of Gateway kore-system\/kore-gateway \(listeners: kore\.local\)/,
  );
});

function renderDelivery(...set: string[]): string {
  const names = [
    "opa-authorizer",
    "kore-postgresql-api",
    "kore-policy-templates",
    "kore-policy-constraints",
    "kore-local-tls",
    "kore-platform-config",
  ];
  const charts = Object.fromEntries(
    names.map((name) => [
      name,
      {
        chart: `registry.example/charts/${name}`,
        digest: `sha256:${"a".repeat(64)}`,
      },
    ]),
  );
  const namespaces = Object.fromEntries(names.map((name) => [name, name]));
  return execFileSync(
    "helm",
    [
      "template",
      "kore-config-delivery",
      join(process.cwd(), "../../infra/charts/platform-config-delivery"),
      "--set-json",
      `charts=${JSON.stringify(charts)}`,
      "--set-json",
      `namespaces=${JSON.stringify(namespaces)}`,
      "--set-string",
      "gatewayClassName=agentgateway",
      ...set,
    ],
    { encoding: "utf8" },
  );
}

test("the delivered Gateway releases are passed the platform domain as gateway.hostname, and no other release is, because their charts hold no default", () => {
  const applications = renderDelivery(
    "--set-string",
    "platformDomain=kore.local",
  )
    .split("\n---\n")
    .filter((doc) => /^kind: Application$/m.test(doc));
  assert.equal(applications.length, 6);
  for (const doc of applications) {
    const name = /^ {2}name: (.+)$/m.exec(doc)![1];
    assert.equal(
      /- name: "gateway\.hostname"\n\s+value: "kore\.local"/.test(doc),
      name === "kore-platform-config" || name === "kore-local-tls",
      `${name} gateway.hostname parameter`,
    );
  }
});

test("a delivery render without the platform domain fails, rather than leaving the Gateway to fail at sync", () => {
  assert.throws(() => renderDelivery(), /platformDomain/);
});
