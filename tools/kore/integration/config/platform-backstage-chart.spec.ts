import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  approvedImageList,
  enabledComponents,
  findRoot,
  loadRepository,
  orderedComponents,
  platformHelmArgs,
  platformPortalFlag,
  validateRepository,
} from "../../src/config/index.js";
import { escapeRegExp, localPlatform } from "../local-platform-support.js";

const platform = await localPlatform();
const domain = escapeRegExp(platform.domain);

// Docs: docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md

const run = promisify(execFile);

async function render(environment: string): Promise<string> {
  const root = await findRoot();
  const repository = await loadRepository(environment);
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-backstage",
  );
  const values = [
    ...(component?.values ?? []),
    ...(repository.environment.componentValues?.["kore-platform-backstage"] ??
      []),
  ].flatMap((file) => ["--values", join(root, file)]);
  const { stdout } = await run("helm", [
    "template",
    "kore-platform-backstage",
    join(root, "infra/charts/platform-backstage"),
    "--namespace",
    "backstage",
    ...values,
    ...platformHelmArgs(repository.environment, "kore-platform-backstage"),
  ]);
  return stdout;
}

const document = (rendered: string, kind: string): string =>
  rendered
    .split(/^---$/m)
    .find((part) => new RegExp(`^kind: ${kind}$`, "m").test(part)) ?? "";

test("the platform Backstage is a flag-gated chart installed after the platform Keycloak and the PostgreSQL API, so with the flag off nothing reaches a cluster", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = await loadRepository(name);
    await validateRepository(repository);
    const backstage = repository.catalog.components.find(
      (c) => c.name === "kore-platform-backstage",
    );
    assert.equal(backstage?.featureFlag, platformPortalFlag);
    assert.equal(backstage?.kind, "local-chart");
    assert.equal(backstage?.namespace, "backstage");
    assert.deepEqual(backstage?.ownsCRDs, []);
    assert.ok(backstage?.dependencies.includes("kore-platform-keycloak"));
    assert.ok(backstage?.dependencies.includes("kore-postgresql-api"));
    assert.deepEqual(backstage?.readiness, ["deployment/backstage"]);
    const installed = enabledComponents(repository).map((c) => c.name);
    assert.equal(installed.includes("kore-platform-backstage"), false);
    const order = orderedComponents(repository.catalog).map((c) => c.name);
    assert.ok(
      order.indexOf("kore-platform-keycloak") <
        order.indexOf("kore-platform-backstage"),
    );
  }
});

test("Backstage listens on loopback only and the Service reaches only the sign-in proxy, so no request gets in without a sign-in", async () => {
  const rendered = await render("local");
  const deployment = document(rendered, "Deployment");
  assert.match(deployment, /APP_CONFIG_backend_listen/);
  assert.match(deployment, /127\.0\.0\.1:7007/);
  const service = document(rendered, "Service");
  assert.match(service, /targetPort: 4180/);
  assert.equal(service.includes("7007"), false);
  assert.equal(deployment.includes("containerPort: 7007"), false);
});

test("the proxy refuses a request with no session and signs in through the platform realm, so Backstage never runs open", async () => {
  const deployment = document(await render("local"), "Deployment");
  assert.match(deployment, /--provider=keycloak-oidc/);
  assert.match(
    deployment,
    new RegExp(
      `--oidc-issuer-url=https://keycloak\\.${domain}/realms/platform`,
    ),
  );
  assert.match(deployment, /--upstream=http:\/\/127\.0\.0\.1:7007/);
  assert.match(deployment, /--cookie-secure=true/);
  assert.match(deployment, /--cookie-httponly=true/);
  assert.equal(deployment.includes("--skip-auth"), false);
  assert.equal(deployment.includes("--skip-provider-button"), false);
  assert.equal(
    deployment.includes("--insecure-oidc-allow-unverified-email"),
    false,
  );
});

test("the proxy holds its client and cookie secrets by Secret reference, so no credential is in git", async () => {
  const rendered = await render("local");
  const deployment = document(rendered, "Deployment");
  assert.match(deployment, /name: backstage-oidc/);
  assert.match(deployment, /key: client-secret/);
  assert.match(deployment, /key: cookie-secret/);
  assert.equal(/kind: Secret\b/.test(rendered), false);
  assert.equal(
    /(secret|password):\s*[A-Za-z0-9]{16,}/i.test(deployment),
    false,
  );
});

test("the Keycloak client is registered for the callback under the platform domain, with its secret by reference", async () => {
  const client = document(await render("local"), "KeycloakOIDCClient");
  assert.match(client, /apiVersion: k8s\.keycloak\.org\/v2alpha1/);
  assert.match(client, /namespace: keycloak/);
  assert.match(client, /keycloakCRName: keycloak/);
  assert.match(client, /realm: platform/);
  assert.match(
    client,
    new RegExp(`https://backstage\\.${domain}/oauth2/callback`),
  );
  assert.match(client, /name: backstage-oidc/);
  assert.match(client, /key: client-secret/);
});

test("the database is claimed through the platform PostgreSQL API and read by reference", async () => {
  const rendered = await render("local");
  const claim = document(rendered, "PostgreSQLInstance");
  assert.match(claim, /name: backstage-db\n/);
  assert.match(claim, /connectionSecretName: backstage-db-connection/);
  const deployment = document(rendered, "Deployment");
  assert.match(deployment, /backstage-db-rw/);
  assert.match(deployment, /name: backstage-db-app/);
});

test("both images are pinned by digest and named by the component, so the install deploys what was verified", async () => {
  const repository = await loadRepository("local");
  const images = repository.approved.images.filter(
    (i) => i.component === "kore-platform-backstage",
  );
  assert.deepEqual(images.map((i) => i.name).sort(), [
    "backstage",
    "oauth2-proxy",
  ]);
  const approved = approvedImageList(repository).map((i) => i.image);
  const deployment = document(await render("local"), "Deployment");
  for (const image of images) {
    assert.match(image.image, /@sha256:[0-9a-f]{64}$/);
    assert.ok(deployment.includes(image.image), image.name);
    assert.ok(approved.includes(image.image));
  }
});

test("the chart carries no image reference, so every image comes from values", async () => {
  const root = await findRoot();
  const text = await readFile(
    join(root, "infra/charts/platform-backstage/templates/backstage.yaml"),
    "utf8",
  );
  assert.equal(/image:\s*["']?[a-z]+[./]/.test(text), false);
});

test("managed-example takes the hosts from its platform domain and both images from the mirror at the same digests", async () => {
  const local = await loadRepository("local");
  const deployment = document(await render("managed-example"), "Deployment");
  assert.match(deployment, /backstage\.platform\.example\.com/);
  assert.match(deployment, /realms\/platform/);
  const digests = local.approved.images
    .filter((i) => i.component === "kore-platform-backstage")
    .map((i) => i.image.split("@")[1]!);
  for (const digest of digests) {
    assert.ok(deployment.includes(`@${digest}`));
  }
  assert.equal(deployment.includes("ghcr.io/backstage"), false);
  assert.equal(deployment.includes("quay.io"), false);
});

async function renderRouted(
  gatewayClassName = "agentgateway",
): Promise<string> {
  const root = await findRoot();
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-backstage",
  );
  const values = (component?.values ?? [])
    .concat(
      repository.environment.componentValues?.["kore-platform-backstage"] ?? [],
    )
    .flatMap((file) => ["--values", join(root, file)]);
  const { stdout } = await run("helm", [
    "template",
    "kore-platform-backstage",
    join(root, "infra/charts/platform-backstage"),
    "--namespace",
    "backstage",
    ...values,
    ...platformHelmArgs(repository.environment, "kore-platform-backstage"),
    "--set-string",
    `gatewayClassName=${gatewayClassName}`,
  ]);
  return stdout;
}

const documents = (rendered: string, kind: string): string[] =>
  rendered
    .split(/^---$/m)
    .filter((part) => new RegExp(`^kind: ${kind}$`, "m").test(part));

test("the portal host routes only to the sign-in proxy's Service, so a request with no sign-in never reaches Backstage", async () => {
  const rendered = await renderRouted();
  const routes = documents(rendered, "HTTPRoute");
  assert.equal(routes.length, 1);
  const route = routes[0]!;
  assert.match(route, new RegExp(`hostnames:\\n\\s+- "backstage\\.${domain}"`));
  const backends = [...route.matchAll(/backendRefs:[\s\S]*?(?=\n\S|$)/g)];
  assert.equal(backends.length, 1);
  assert.match(route, /name: backstage\n\s+port: 80/);
  assert.equal(route.includes("7007"), false);
  assert.equal(/name: backstage-db/.test(route), false);
  // The Service the route names targets the proxy's port, never Backstage's.
  assert.match(document(rendered, "Service"), /targetPort: 4180/);
});

test("exactly one route and one Service are exposed, and no route or Service names Backstage's own port, so there is no second way in", async () => {
  const rendered = await renderRouted();
  assert.equal(documents(rendered, "HTTPRoute").length, 1);
  assert.equal(documents(rendered, "Service").length, 1);
  for (const kind of ["Ingress", "TCPRoute", "GRPCRoute", "TLSRoute"]) {
    assert.equal(documents(rendered, kind).length, 0, kind);
  }
  for (const part of [
    ...documents(rendered, "HTTPRoute"),
    ...documents(rendered, "Service"),
  ]) {
    assert.equal(part.includes("7007"), false);
  }
  assert.equal(/kind: (NodePort|LoadBalancer)/.test(rendered), false);
});

test("the portal host is served over HTTPS from a certificate for that host only, in the Backstage namespace", async () => {
  const rendered = await renderRouted();
  const gateway = document(rendered, "Gateway");
  assert.match(gateway, /namespace: backstage/);
  assert.match(gateway, /gatewayClassName: "agentgateway"/);
  assert.match(gateway, new RegExp(`hostname: "backstage\\.${domain}"`));
  assert.match(gateway, /protocol: HTTPS/);
  assert.match(gateway, /mode: Terminate/);
  assert.match(gateway, /from: Same/);
  const certificate = document(rendered, "Certificate");
  assert.match(certificate, new RegExp(`- "backstage\\.${domain}"`));
  assert.match(certificate, /name: kore-local-ca/);
  assert.match(certificate, /secretName: backstage-tls/);
  assert.match(gateway, /name: backstage-tls/);
  const route = document(rendered, "HTTPRoute");
  assert.match(route, /kind: Gateway\n\s+name: backstage/);
});

test("the managed-example portal host comes from its platform domain, so the route is never a hard-coded host", async () => {
  const root = await findRoot();
  const repository = await loadRepository("managed-example");
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-backstage",
  );
  const values = [
    ...(component?.values ?? []),
    ...(repository.environment.componentValues?.["kore-platform-backstage"] ??
      []),
  ].flatMap((file) => ["--values", join(root, file)]);
  const { stdout } = await run("helm", [
    "template",
    "kore-platform-backstage",
    join(root, "infra/charts/platform-backstage"),
    "--namespace",
    "backstage",
    ...values,
    ...platformHelmArgs(repository.environment, "kore-platform-backstage"),
    "--set-string",
    "gatewayClassName=agentgateway",
  ]);
  assert.match(
    document(stdout, "HTTPRoute"),
    /"backstage\.platform\.example\.com"/,
  );
  assert.equal(stdout.includes(platform.domain), false);
});

test("the route renders only once the gateway class is given, so a render without it adds no resource", async () => {
  const rendered = await render("local");
  for (const kind of ["Gateway", "HTTPRoute", "Certificate"]) {
    assert.equal(documents(rendered, kind).length, 0, kind);
  }
});

test("group authorization stays with the platform-operators group, and the route adds no second grant", async () => {
  const rendered = await renderRouted();
  const rbac = documents(rendered, "ClusterRoleBinding").join("\n");
  assert.match(rbac, /platform-operators/);
  for (const part of [
    ...documents(rendered, "HTTPRoute"),
    ...documents(rendered, "Gateway"),
  ]) {
    assert.equal(/kind: (Cluster)?Role/.test(part), false);
  }
  const subjects = [...rendered.matchAll(/kind: Group\n\s+name: (\S+)/g)].map(
    (m) => m[1],
  );
  assert.ok(subjects.length > 0);
  assert.ok(subjects.every((s) => s === "platform-operators"));
});
