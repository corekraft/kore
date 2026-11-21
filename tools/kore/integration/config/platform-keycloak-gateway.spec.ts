// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
// Docs: docs/decisions/0133-the-platform-owns-the-gateway-its-listeners-and-its-certificate-charts-own-routes-only.md
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  findRoot,
  loadRepository,
  platformHelmArgs,
  type Repository,
} from "../../src/config/index.js";
import { localPlatform } from "../local-platform-support.js";

// With platform-shared-gateway on, Keycloak is served at one name through the
// platform Gateway, and the portal's OIDC issuer names that same host. These
// specs state the flag on and off instead of reading the local overlay's default.

const run = promisify(execFile);
const sharedGatewayFlag = "platform-shared-gateway";

async function render(
  chart: string,
  component: string,
  namespace: string,
  shared: boolean,
): Promise<string> {
  const root = await findRoot();
  const base = await loadRepository("local");
  const features: Record<string, boolean> = { ...base.environment.features };
  features[sharedGatewayFlag] = shared;
  const repository: Repository = {
    ...base,
    environment: { ...base.environment, features },
  };
  const found = repository.catalog.components.find((c) => c.name === component);
  const values = [
    ...(found?.values ?? []),
    ...(repository.environment.componentValues?.[component] ?? []),
  ].flatMap((file) => ["--values", join(root, file)]);
  // kore hands the feature flags to kore-platform-config as features.<flag>.
  const featureArgs =
    component === "kore-platform-config" && shared
      ? ["--set", `features.${sharedGatewayFlag}=true`]
      : [];
  const { stdout } = await run("helm", [
    "template",
    component,
    join(root, chart),
    "--namespace",
    namespace,
    ...values,
    ...platformHelmArgs(repository.environment, component),
    ...featureArgs,
    ...(component === "kore-platform-config"
      ? ["--set-string", "gateway.className=agentgateway"]
      : []),
  ]);
  return stdout;
}

const documents = (rendered: string, kind: string): string[] =>
  rendered
    .split(/^---$/m)
    .filter((part) => new RegExp(`^kind: ${kind}$`, "m").test(part));

const listenerHostname = (gateway: string, name: string): string | undefined =>
  gateway.match(
    new RegExp(`- name: ${name}\\n\\s+hostname: "?([^"\\n]+)"?`),
  )?.[1];

test("with platform-shared-gateway on, the Keycloak host is one name in the platform Gateway's listener, the Keycloak route, the Keycloak hostname and the portal's OIDC issuer", async () => {
  const { domain } = await localPlatform();
  const host = `keycloak.platform.${domain}`;
  const gateway = await render(
    "infra/charts/platform-config",
    "kore-platform-config",
    "kore-system",
    true,
  );
  const keycloak = await render(
    "infra/charts/platform-keycloak",
    "kore-platform-keycloak",
    "keycloak",
    true,
  );
  const portal = await render(
    "infra/charts/platform-backstage",
    "kore-platform-backstage",
    "backstage",
    true,
  );
  const [route] = documents(keycloak, "HTTPRoute");
  const keycloakHostname = keycloak.match(/^ {4}hostname: (\S+)$/m)?.[1];
  assert.equal(
    keycloakHostname,
    `https://${host}`,
    "Keycloak advertises https, the scheme the platform Gateway terminates",
  );
  const issuer = portal.match(
    /--oidc-issuer-url=https:\/\/([^/\s]+)\/realms\/platform/,
  )?.[1];
  const metadata = portal.match(
    /name: OIDC_METADATA_URL\n\s+value: https:\/\/([^/\s]+)\//,
  )?.[1];
  assert.deepEqual(
    [
      listenerHostname(gateway, "https-keycloak"),
      route?.match(/hostnames:\n\s+- "([^"]+)"/)?.[1],
      keycloakHostname?.replace("https://", ""),
      issuer,
      metadata,
    ],
    [host, host, host, host, host],
  );
});

test("the Keycloak route attaches to the platform Gateway and reaches only the Keycloak service's HTTP port", async () => {
  const keycloak = await render(
    "infra/charts/platform-keycloak",
    "kore-platform-keycloak",
    "keycloak",
    true,
  );
  const [route] = documents(keycloak, "HTTPRoute");
  assert.ok(route, "the Keycloak chart renders one HTTPRoute with the flag on");
  assert.match(
    route,
    /parentRefs:\n\s+- kind: Gateway\n\s+name: kore-gateway\n\s+namespace: kore-system/,
  );
  assert.match(
    route,
    /backendRefs:\n\s+- name: keycloak-service\n\s+port: 8080/,
  );
  assert.equal(documents(keycloak, "Gateway").length, 0);
  assert.equal(documents(keycloak, "Certificate").length, 0);
});

test("with platform-shared-gateway off nothing reaches the Gateway for Keycloak, and its host stays under the bare platform domain", async () => {
  const { domain } = await localPlatform();
  const gateway = await render(
    "infra/charts/platform-config",
    "kore-platform-config",
    "kore-system",
    false,
  );
  const keycloak = await render(
    "infra/charts/platform-keycloak",
    "kore-platform-keycloak",
    "keycloak",
    false,
  );
  const portal = await render(
    "infra/charts/platform-backstage",
    "kore-platform-backstage",
    "backstage",
    false,
  );
  assert.equal(listenerHostname(gateway, "https-keycloak"), undefined);
  assert.equal(documents(keycloak, "HTTPRoute").length, 0);
  assert.match(
    keycloak,
    new RegExp(`^ {4}hostname: https://keycloak\\.${domain}$`, "m"),
  );
  assert.match(
    portal,
    new RegExp(
      `--oidc-issuer-url=https://keycloak\\.${domain}/realms/platform`,
    ),
  );
});

test("the Keycloak component labels its namespace for the shared Gateway, so the Gateway admits its route", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-keycloak",
  );
  assert.equal(component?.sharedGatewayRoutes, true);
});
