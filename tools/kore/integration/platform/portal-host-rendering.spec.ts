import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "vitest";
import {
  loadRepository,
  platformHelmArgs,
  platformPlan,
  type Repository,
} from "../../src/config/index.js";
import { escapeRegExp } from "../local-platform-support.js";

// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
// Docs: docs/decisions/0133-the-platform-owns-the-gateway-its-listeners-and-its-certificate-charts-own-routes-only.md
// The portal has one host. These specs render the real portal chart to prove its
// route, its base URL, its sign-in redirect and its Keycloak client all name the
// host the shared Gateway serves, and that the chart's own Gateway is dropped
// while the shared one carries the route. No cluster.

function withSharedGateway(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        "platform-shared-gateway": on,
      },
    },
  };
}

function renderPortal(repository: Repository): string {
  return execFileSync(
    "helm",
    [
      "template",
      "kore-platform-backstage",
      join(repository.root, "infra/charts/platform-backstage"),
      "--namespace",
      "backstage",
      "--values",
      join(
        repository.root,
        "infra/environments/common/values/platform-backstage.yaml",
      ),
      "--set-string",
      "gatewayClassName=agentgateway",
      ...platformHelmArgs(repository.environment, "kore-platform-backstage"),
    ],
    { cwd: repository.root, encoding: "utf8" },
  );
}

test("with platform-shared-gateway on the portal serves the organization's host the shared Gateway answers, and its own Gateway and certificate are dropped", async () => {
  const local = await loadRepository("local");
  const { domain, organizationId } = platformPlan(local.environment);
  const host = `backstage.${organizationId}.${domain}`;
  const rendered = renderPortal(withSharedGateway(local, true));
  assert.ok(
    rendered.includes(`--redirect-url=https://${host}/oauth2/callback`),
    "the sign-in proxy redirects to the shared host",
  );
  assert.ok(rendered.includes(`baseUrl: https://${host}`));
  assert.ok(rendered.includes(`- https://${host}/oauth2/callback`));
  assert.ok(
    rendered.includes(`- "${host}"`),
    "the shared route names the host",
  );
  assert.doesNotMatch(rendered, /^kind: Gateway$/m);
  assert.doesNotMatch(rendered, /^kind: Certificate$/m);
  assert.doesNotMatch(
    rendered,
    new RegExp(escapeRegExp(`backstage.${domain}`)),
    "no copy of the bare platform domain's portal host is left",
  );
}, 30_000);

test("with platform-shared-gateway off the portal stays on the bare platform domain, served by the chart's own Gateway and no shared route", async () => {
  const local = await loadRepository("local");
  const { domain } = platformPlan(local.environment);
  const host = `backstage.${domain}`;
  const rendered = renderPortal(withSharedGateway(local, false));
  assert.match(rendered, /^kind: Gateway$/m);
  assert.ok(rendered.includes(`- "${host}"`));
  assert.ok(
    rendered.includes(`--redirect-url=https://${host}/oauth2/callback`),
  );
  assert.doesNotMatch(rendered, /name: backstage-shared$/m);
}, 30_000);
