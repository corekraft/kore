import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  componentValues,
  enabledComponents,
  loadRepository,
  platformArgocdDeliveryFlag,
  platformHelmArgs,
  platformPlan,
  validateRepository,
  type Repository,
  internalGateway,
} from "../../src/config/index.js";
import {
  composeChartDelivery,
  helmTemplateArgs,
  routeHostErrors,
} from "../../src/platform/index.js";
import {
  loadLocalGatewayFlagsOff,
  withAbsoluteChart,
  withPlatformDnsOn,
} from "../../src/testing/index.js";
import { escapeRegExp, localPlatform } from "../local-platform-support.js";

const platform = await localPlatform();

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

// The shared Gateway adds the organization's wildcard listener, so the route
// host specs state the flag instead of reading the local overlay's default.
const sharedGatewayFlag = "platform-shared-gateway";

function withSharedGateway(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [sharedGatewayFlag]: on,
      },
    },
  };
}

function renderReferenceRoute(repository: Repository, host: string): string {
  const gateway = internalGateway(repository.environment);
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

test("the local overlay declares the platform organization, so rendering is unchanged", async () => {
  const repository = await loadRepository("local");
  assert.deepEqual(platformPlan(repository.environment), {
    domain: platform.domain,
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
      new RegExp(escapeRegExp(platform.domain)),
      `${component} keeps no copy of the local domain`,
    );
    assert.ok(rendered.includes("moved.example"));
  }
  assert.doesNotMatch(
    renderBackstage(moved),
    new RegExp(escapeRegExp(platform.domain)),
  );
  assert.ok(renderBackstage(moved).includes("platform.moved.example"));
}, 30_000);

test("a malformed platform field is refused by validation before any chart renders", async () => {
  const local = await loadRepository("local");
  for (const field of [
    { domain: "Kore.Local", organizationId: "platform" },
    { domain: "kore", organizationId: "platform" },
    { domain: platform.domain, organizationId: "Platform" },
  ]) {
    await assert.rejects(
      validateRepository({
        ...local,
        environment: { ...local.environment, platform: field },
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
    const repository = withSharedGateway(await loadRepository(name), false);
    const gateway = internalGateway(repository.environment);
    const { domain } = platformPlan(repository.environment);
    const rendered = [
      render(repository, "kore-platform-config"),
      renderReferenceRoute(repository, domain),
    ].join("\n---\n");
    assert.deepEqual(routeHostErrors(rendered, gateway), []);
  }
});

test("a route host the platform Gateway has no listener for fails the check, naming the host", async () => {
  const local = withPlatformDnsOn(await loadLocalGatewayFlagsOff());
  const repository = withSharedGateway(local, false);
  const rendered = [
    render(repository, "kore-platform-config"),
    renderReferenceRoute(repository, "moved.example.test"),
  ].join("\n---\n");
  const gateway = internalGateway(repository.environment);
  const errors = routeHostErrors(rendered, gateway);
  assert.equal(errors.length, 1);
  assert.match(
    errors[0]!,
    new RegExp(
      `^HTTPRoute reference host moved\\.example\\.test matches no listener hostname of Gateway kore-system/kore-gateway \\(listeners: ${escapeRegExp(platform.domain)}\\)`,
    ),
  );
});

// The charts, namespaces and platform wildcard kore composes for the six
// releases the flags-off handover hands over, from the same lock and catalog
// the release renders with, so the render takes what production composes.
// The flags-off handover: argocd delivery on, every other catalog flag off, so
// six releases are handed over. Production composes the values from a lock
// that covers each of them.
async function composedDelivery() {
  const repository = await loadRepository("local");
  const flags = new Set([
    ...Object.keys(repository.environment.features ?? {}),
    ...repository.catalog.components.flatMap((c) =>
      c.featureFlag === undefined ? [] : [c.featureFlag],
    ),
  ]);
  const flagged: Repository = {
    ...repository,
    environment: {
      ...repository.environment,
      features: Object.fromEntries(
        [...flags].map((flag) => [flag, flag === platformArgocdDeliveryFlag]),
      ),
    },
  };
  const names = enabledComponents(flagged)
    .filter((c) => c.owner === "argocd")
    .map((c) => c.name);
  const dir = await mkdtemp(join(tmpdir(), "delivery-render-"));
  const lockPath = join(dir, "platform-charts.lock.json");
  await writeFile(
    lockPath,
    JSON.stringify({
      version: 1,
      entries: Object.fromEntries(
        names.map((name) => [
          name,
          {
            chart: `registry.example.com/charts/${name}`,
            digest: `sha256:${"a".repeat(64)}`,
          },
        ]),
      ),
    }),
  );
  return composeChartDelivery(flagged, lockPath);
}

const delivered = await composedDelivery();
assert.ok(delivered.chartDelivery);
const { charts, namespaces, platformHostname } = delivered.chartDelivery;

function renderDelivery(...set: string[]): string {
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
      "--set-string",
      `platformHostname=${platformHostname}`,
      ...set,
    ],
    { encoding: "utf8" },
  );
}

test("the delivered Gateway releases are passed the platform domain as gateway.hostname, and no other release is, because their charts hold no default", () => {
  const applications = renderDelivery(
    "--set-string",
    `platformDomain=${platform.domain}`,
  )
    .split("\n---\n")
    .filter((doc) => /^kind: Application$/m.test(doc));
  assert.equal(applications.length, 6);
  for (const doc of applications) {
    const name = /^ {2}name: (.+)$/m.exec(doc)![1];
    assert.equal(
      new RegExp(
        `- name: "gateway\\.hostname"\\n\\s+value: "${escapeRegExp(platform.domain)}"`,
      ).test(doc),
      name === "kore-platform-config" || name === "kore-local-tls",
      `${name} gateway.hostname parameter`,
    );
  }
});

test("a delivery render without the platform domain fails, rather than leaving the Gateway to fail at sync", () => {
  assert.throws(() => renderDelivery(), /platformDomain/);
});
