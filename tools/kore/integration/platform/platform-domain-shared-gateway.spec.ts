// Docs: docs/decisions/0133-the-platform-owns-the-gateway-its-listeners-and-its-certificate-charts-own-routes-only.md
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "vitest";
import {
  loadRepository,
  platformPlan,
  type Repository,
} from "../../src/config/index.js";
import { helmTemplateArgs, routeHostErrors } from "../../src/platform/index.js";
import {
  withAbsoluteChart,
  withGatewayFlagsOff,
} from "../../src/testing/index.js";
import { escapeRegExp } from "../local-platform-support.js";

// With platform-shared-gateway on, the platform Gateway gains a listener for
// the organization's wildcard, so a route host under the organization is
// served and any other host still fails naming the host. These specs state the
// flag instead of reading the local overlay's default.

const sharedGatewayFlag = "platform-shared-gateway";

async function local(sharedGateway: boolean): Promise<Repository> {
  const base = withGatewayFlagsOff(await loadRepository("local"));
  return {
    ...base,
    environment: {
      ...base.environment,
      features: {
        ...base.environment.features,
        [sharedGatewayFlag]: sharedGateway,
      },
    },
  };
}

function renderConfig(repository: Repository): string {
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-config",
  )!;
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

function routeErrors(repository: Repository, host: string): string[] {
  const { gateway } = repository.environment;
  const route = execFileSync(
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
  return routeHostErrors(
    [renderConfig(repository), route].join("\n---\n"),
    gateway,
  );
}

test("with the flag on a route host under the organization is served by the wildcard listener, and so is the platform domain itself", async () => {
  const repository = await local(true);
  const { domain, organizationId } = platformPlan(repository.environment);
  for (const host of [domain, `app.${organizationId}.${domain}`]) {
    assert.deepEqual(routeErrors(repository, host), [], host);
  }
});

test("with the flag on a host outside the platform domain still fails the check, naming the host and every listener", async () => {
  const repository = await local(true);
  const { domain, organizationId } = platformPlan(repository.environment);
  const errors = routeErrors(repository, "moved.example.test");
  assert.equal(errors.length, 1);
  assert.match(
    errors[0]!,
    new RegExp(
      `^HTTPRoute reference host moved\\.example\\.test matches no listener hostname of Gateway kore-system/kore-gateway \\(listeners: ${escapeRegExp(domain)}, ${escapeRegExp(repository.environment.platform?.deprecatedAlias ?? "")}, ${escapeRegExp(`*.${organizationId}.${domain}`)}\\)`,
    ),
  );
});

test("with the flag off a host under the organization has no listener and fails the check, so the wildcard listener comes only with the flag", async () => {
  const repository = await local(false);
  const { domain, organizationId } = platformPlan(repository.environment);
  const errors = routeErrors(repository, `app.${organizationId}.${domain}`);
  assert.equal(errors.length, 1);
  assert.match(
    errors[0]!,
    new RegExp(
      `^HTTPRoute reference host app\\.${escapeRegExp(`${organizationId}.${domain}`)} matches no listener hostname of Gateway kore-system/kore-gateway \\(listeners: ${escapeRegExp(domain)}, ${escapeRegExp(repository.environment.platform?.deprecatedAlias ?? "")}\\)`,
    ),
  );
});
