import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  findRoot,
  loadRepository,
  platformHelmArgs,
} from "../../src/config/index.js";
import { escapeRegExp, localPlatform } from "../local-platform-support.js";

const platform = await localPlatform();
const domain = escapeRegExp(platform.domain);

// Docs: docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md

const run = promisify(execFile);

async function source(path: string): Promise<string> {
  return readFile(join(await findRoot(), "images/backstage", path), "utf8");
}

async function render(): Promise<string> {
  const root = await findRoot();
  const repository = await loadRepository("local");
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

test("the app signs in through Keycloak only: no guest provider is configured or installed", async () => {
  const config = JSON.parse(await source("app-config.yaml"));
  const providers = Object.keys(config.auth.providers);
  assert.deepEqual(providers, ["oidc"]);
  assert.equal((await source("src/index.js")).includes("guest"), false);
  assert.equal((await source("package.json")).includes("guest"), false);
});

// Docs: docs/decisions/0180-backstage-reads-the-argo-cd-view-as-its-own-service-account-gated-by-the-operators-policy.md
test("the Kubernetes plugin reads as Backstage's service account, with the token from the environment and no OIDC token provider", async () => {
  const config = JSON.parse(await source("app-config.yaml"));
  const [cluster] = config.kubernetes.clusterLocatorMethods[0].clusters;
  assert.equal(cluster.authProvider, "serviceAccount");
  assert.equal(cluster.serviceAccountToken, "${K8S_SA_TOKEN}");
  assert.equal("oidcTokenProvider" in cluster, false);
});

test("the backend wires the group sign-in resolver and the catalog provider, and the catalog refreshes on a schedule", async () => {
  const index = await source("src/index.js");
  assert.match(index, /resolveSignIn/);
  assert.match(index, /createProvider/);
  assert.match(index, /listPlatformObjects/);
  assert.match(index, /schedule|setInterval|frequency/);
});

test("the chart gives Backstage the OIDC values by Secret reference and a read-only role over Organization and Service only", async () => {
  const rendered = await render();
  const deployment = document(rendered, "Deployment");
  for (const name of [
    "OIDC_METADATA_URL",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
  ]) {
    assert.match(deployment, new RegExp(`name: ${name}\\b`));
  }
  assert.match(deployment, /serviceAccountName: backstage/);
  // The only Secret is the data-less service account token Secret (ADR 0180).
  const secrets = rendered
    .split(/^---$/m)
    .filter((part) => /^kind: Secret$/m.test(part));
  assert.equal(secrets.length, 1);
  assert.match(secrets[0] ?? "", /type: kubernetes\.io\/service-account-token/);
  const role = document(rendered, "ClusterRole");
  assert.match(role, /apiGroups: \["platform\.kore\.dev"\]/);
  assert.match(role, /resources: \["organizations", "services"\]/);
  assert.match(role, /verbs: \["get", "list"\]/);
  assert.equal(/\*/.test(role), false);
});

test("the sign-in proxy and its fail-closed gating stay until a live run proves in-app sign-in", async () => {
  const deployment = document(await render(), "Deployment");
  assert.match(deployment, /name: proxy/);
  assert.match(deployment, /--upstream=http:\/\/127\.0\.0\.1:7007/);
  assert.match(deployment, /containerPort: 4180/);
});

test("the Backstage client is a Crossplane-managed Keycloak client in the platform realm, with its secret by reference and no operator client", async () => {
  const rendered = await render();
  const client = document(rendered, "Client");
  assert.match(
    client,
    /^apiVersion: openidclient\.keycloak\.m\.crossplane\.io\/v1alpha1$/m,
  );
  assert.match(client, /^  name: backstage\n  namespace: backstage$/m);
  assert.match(
    client,
    /providerConfigRef:\n\s+kind: ClusterProviderConfig\n\s+name: keycloak/,
  );
  assert.match(client, /clientId: backstage/);
  assert.match(client, /realmId: platform/);
  assert.match(client, /accessType: CONFIDENTIAL/);
  assert.match(client, /standardFlowEnabled: true/);
  assert.match(client, /implicitFlowEnabled: false/);
  assert.match(client, /directAccessGrantsEnabled: false/);
  assert.match(
    client,
    new RegExp(
      `validRedirectUris:\\n\\s+- https://backstage\\.platform\\.${domain}/oauth2/callback\\n\\s+- https://backstage\\.platform\\.${domain}/api/auth/oidc/handler/frame\\n`,
    ),
  );
  assert.match(
    client,
    /clientSecretSecretRef:\n\s+name: backstage-oidc\n\s+key: client-secret/,
  );
  assert.equal(document(rendered, "KeycloakOIDCClient"), "");
});

// Docs: docs/decisions/0180-backstage-reads-the-argo-cd-view-as-its-own-service-account-gated-by-the-operators-policy.md
// In-app sign-in (found live, #1883): the auth backend mints the Backstage
// identity every API call needs, so the client accepts its callback too.
test("the Backstage client accepts the sign-in proxy's callback and the auth backend's frame callback, and no other redirect", async () => {
  const root = await findRoot();
  const client = await readFile(
    join(root, "infra/charts/platform-backstage/templates/oidc-client.yaml"),
    "utf8",
  );
  assert.match(
    client,
    /validRedirectUris:\n\s+- https:\/\/\{\{ \.Values\.backstageHostname \}\}\/oauth2\/callback\n\s+- https:\/\/\{\{ \.Values\.backstageHostname \}\}\/api\/auth\/oidc\/handler\/frame\n/,
  );
  assert.equal((client.match(/^\s+- https:/gm) ?? []).length, 2);
});

test("the Backstage client carries a groups claim in the id token, access token and userinfo, so the sign-in resolver sees the operators group", async () => {
  const mapper = document(await render(), "GroupMembershipProtocolMapper");
  assert.match(
    mapper,
    /apiVersion: openidgroup\.keycloak\.m\.crossplane\.io\/v1alpha1/,
  );
  assert.match(mapper, /claimName: groups/);
  assert.match(mapper, /realmId: platform/);
  assert.match(mapper, /clientIdRef:\n\s+name: backstage/);
  assert.match(mapper, /fullPath: true/);
  assert.match(mapper, /addToIdToken: true/);
  assert.match(mapper, /addToUserinfo: true/);
  assert.match(mapper, /name: ClusterProviderConfig|name: keycloak/);
});

test("the auth backend's session secret comes from the cookie secret by reference, on the Backstage container", async () => {
  const deployment = document(await render(), "Deployment");
  const backstage = deployment.slice(deployment.indexOf("- name: backstage"));
  assert.match(
    backstage,
    /name: APP_CONFIG_auth_session_secret\n\s+valueFrom:\n\s+secretKeyRef:\n\s+name: backstage-oidc\n\s+key: cookie-secret/,
  );
});

test("the Kubernetes plugin shows each service's Argo CD Application beside its workload, read as the service account", async () => {
  const config = JSON.parse(await source("app-config.yaml"));
  assert.deepEqual(config.kubernetes.customResources, [
    { group: "argoproj.io", apiVersion: "v1alpha1", plural: "applications" },
  ]);
  const [cluster] = config.kubernetes.clusterLocatorMethods[0].clusters;
  assert.equal(cluster.authProvider, "serviceAccount");
});

test("the Argo CD view is read by Backstage's own service account with a read-only role, from a long-lived token Secret, and only operators may ask", async () => {
  const documents = (await render()).split(/^---$/m);
  const named = (kind: string): string | undefined =>
    documents.find(
      (part) =>
        new RegExp(`^kind: ${kind}$`, "m").test(part) &&
        /^ {2}name: kore-backstage-argocd-view$/m.test(part),
    );
  const role = named("ClusterRole");
  assert.ok(role, "the view role is rendered");
  assert.match(role, /apiGroups: \["argoproj\.io"\]/);
  assert.match(role, /resources: \["applications"\]/);
  assert.match(role, /apiGroups: \["apps"\]/);
  assert.match(role, /resources: \["deployments"\]/);
  assert.equal((role.match(/verbs: \["get", "list"\]/g) ?? []).length, 2);
  assert.equal(/\*|create|update|patch|delete/.test(role), false);
  const binding = named("ClusterRoleBinding");
  assert.ok(binding, "the view binding is rendered");
  assert.match(binding, /kind: ServiceAccount\n\s+name: backstage\n/);
  assert.equal(/kind: Group/.test(binding), false);
  const secret = documents.find(
    (part) =>
      /^kind: Secret$/m.test(part) &&
      /kubernetes\.io\/service-account-token/.test(part),
  );
  assert.ok(secret, "the service account token Secret is rendered");
  assert.match(secret, /kubernetes\.io\/service-account\.name: backstage/);
  const deployment = documents.find((part) => /^kind: Deployment$/m.test(part));
  assert.match(
    deployment ?? "",
    /name: K8S_SA_TOKEN\n\s+valueFrom:\n\s+secretKeyRef:\n\s+name: backstage-sa-token\n\s+key: token/,
  );
  assert.match(secret, /name: backstage-sa-token/);
  const policy = await source("src/policy.js");
  assert.match(policy, /group:default\/platform-operators/);
});

test("every Backstage dependency is an exact version and the lockfile resolves each to it", async () => {
  const manifest = JSON.parse(await source("package.json"));
  const lock = JSON.parse(await source("package-lock.json"));
  const resolved = Object.fromEntries(
    Object.keys(manifest.dependencies).map((name) => [
      name,
      lock.packages[`node_modules/${name}`]?.version,
    ]),
  );
  assert.deepEqual(resolved, manifest.dependencies);
  for (const version of Object.values<string>(manifest.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
  }
});
