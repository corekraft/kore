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
  type Repository,
} from "../../src/config/index.js";
import { withGatewayFlagsOff } from "../../src/testing/index.js";
import { escapeRegExp, localPlatform } from "../local-platform-support.js";

const platform = await localPlatform();
const domain = escapeRegExp(platform.domain);

// Docs: docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md

const run = promisify(execFile);

// The flag decides whether the portal also attaches a route to the shared
// Gateway, so every render here states it off; the shared-on cases are in
// platform-backstage-shared-gateway.spec.ts.
async function withFlagOff(environment: string): Promise<Repository> {
  const base = await loadRepository(environment);
  return {
    ...base,
    environment: {
      ...base.environment,
      features: {
        ...base.environment.features,
        "platform-shared-gateway": false,
      },
    },
  };
}

async function renderWith(
  repository: Repository,
  extra: string[] = [],
): Promise<string> {
  const root = await findRoot();
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
    ...extra,
  ]);
  return stdout;
}

async function render(environment: string): Promise<string> {
  return renderWith(await withFlagOff(environment));
}

const document = (rendered: string, kind: string): string =>
  rendered
    .split(/^---$/m)
    .find((part) => new RegExp(`^kind: ${kind}$`, "m").test(part)) ?? "";

test("the platform Backstage is a flag-gated chart installed after the platform Keycloak and the PostgreSQL API, so with the flag off nothing reaches a cluster", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = withGatewayFlagsOff(await loadRepository(name));
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
    assert.deepEqual(backstage?.readiness, [
      "client.openidclient.keycloak.m.crossplane.io/backstage",
      "deployment/backstage",
    ]);
    assert.ok(backstage?.dependencies.includes("keycloak-provider"));
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
  // The only Secret is the service account token the control plane fills in:
  // it carries no data in git (ADR 0180).
  const secrets = documents(rendered, "Secret");
  assert.equal(secrets.length, 1);
  assert.match(secrets[0] ?? "", /type: kubernetes\.io\/service-account-token/);
  assert.equal(/^data:|^stringData:/m.test(secrets[0] ?? ""), false);
  assert.equal(
    /(secret|password):\s*[A-Za-z0-9]{16,}/i.test(deployment),
    false,
  );
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
  return renderWith(await withFlagOff("local"), [
    "--set-string",
    `gatewayClassName=${gatewayClassName}`,
  ]);
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
  const stdout = await renderWith(await withFlagOff("managed-example"), [
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
  assert.equal(/kind: Group/.test(rbac), false);
  for (const part of [
    ...documents(rendered, "HTTPRoute"),
    ...documents(rendered, "Gateway"),
  ]) {
    assert.equal(/kind: (Cluster)?Role/.test(part), false);
  }
  const subjects = [...rendered.matchAll(/kind: Group\n\s+name: (\S+)/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(subjects, []);
});

// The pod sets runAsNonRoot, and the kubelet can only verify it when each
// container names a numeric uid: the Kore-built Backstage image runs as the
// numeric 65532 (its Dockerfile's USER), and the proxy image's user is 65532.
test("each Backstage container names the numeric uid of its image's user, so the kubelet can verify non-root", async () => {
  const deployment = document(await render("local"), "Deployment");
  assert.match(deployment, /^ {8}runAsNonRoot: true$/m);
  const containers =
    deployment.split(/^ {6}containers:$/m)[1]?.split(/^ {6}\S/m)[0] ?? "";
  const uids = Object.fromEntries(
    containers
      .split(/^ {8}- name: /m)
      .slice(1)
      .map((part) => [
        part.split("\n")[0],
        /^ {12}runAsUser: (\d+)$/m.exec(part)?.[1] ?? null,
      ]),
  );
  assert.deepEqual(uids, { proxy: "65532", backstage: "65532" });
});

// The proxy exits when Keycloak's realm is not serving discovery yet, and
// Kubernetes then backs the restart off for minutes (issue 1788). With
// keycloakWait the pod's init container polls the realm until it answers, so
// neither container starts before Keycloak is ready.
const initContainers = (deployment: string): string =>
  deployment
    .split(/^ {6}initContainers:$/m)[1]
    ?.split(/^ {6}containers:$/m)[0] ?? "";

test("with keycloakWait off the Deployment has no init container, so the portal renders as before", async () => {
  const deployment = document(await render("local"), "Deployment");
  assert.equal(deployment.includes("initContainers"), false);
});

test("with keycloakWait on an init container polls the realm's discovery until it answers, before either container starts", async () => {
  const rendered = await renderWith(await withFlagOff("local"), [
    "--set",
    "keycloakWait=true",
  ]);
  const init = initContainers(document(rendered, "Deployment"));
  const discovery = `https://keycloak.${platform.domain}/realms/platform/.well-known/openid-configuration`;
  const command = `            - "(async () => { for (;;) { try { if ((await fetch(\\"${discovery}\\")).ok) process.exit(0); } catch (e) {} await new Promise((r) => setTimeout(r, 2000)); } })();"`;
  assert.ok(init.includes(command), init);
  assert.match(init, /^ {8}- name: wait-for-keycloak$/m);
  assert.match(init, /^ {12}- \/nodejs\/bin\/node$/m);
});

test("the init container runs the portal's pinned Backstage image as the numeric non-root uid and holds no credential", async () => {
  const repository = await loadRepository("local");
  const backstage = repository.approved.images.find(
    (i) => i.component === "kore-platform-backstage" && i.name === "backstage",
  );
  const rendered = await renderWith(await withFlagOff("local"), [
    "--set",
    "keycloakWait=true",
  ]);
  const init = initContainers(document(rendered, "Deployment"));
  assert.ok(init.includes(`image: "${backstage?.image}"`), init);
  assert.match(init, /^ {12}runAsUser: 65532$/m);
  assert.equal(init.includes("secretKeyRef"), false);
});

test("with the local CA the init container trusts the local CA bundle, as the Backstage container does", async () => {
  const rendered = await renderWith(await withFlagOff("local"), [
    "--set",
    "keycloakWait=true",
    "--set-string",
    "localCa.configMap=kore-local-ca",
  ]);
  const init = initContainers(document(rendered, "Deployment"));
  assert.match(init, /^ {14}value: \/etc\/kore\/local-ca\/bundle\.crt$/m);
  assert.match(init, /mountPath: \/etc\/kore\/local-ca$/m);
});
