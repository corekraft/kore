import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot, loadRepository } from "../../src/config/index.js";

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

test("the Kubernetes plugin reads as the signed-in user, with no service account token configured", async () => {
  const config = JSON.parse(await source("app-config.yaml"));
  const [cluster] = config.kubernetes.clusterLocatorMethods[0].clusters;
  assert.equal(cluster.authProvider, "oidc");
  assert.equal(cluster.oidcTokenProvider, "oidc");
  assert.equal("serviceAccountToken" in cluster, false);
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
  assert.equal(/kind: Secret\b/.test(rendered), false);
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

test("the Keycloak client also accepts the in-app sign-in callback, beside the proxy's", async () => {
  const root = await findRoot();
  const client = await readFile(
    join(root, "infra/charts/platform-backstage/templates/oidc-client.yaml"),
    "utf8",
  );
  assert.match(
    client,
    /backstage\.\{\{ \.Values\.platformDomain \}\}\/oauth2\/callback/,
  );
  assert.match(
    client,
    /backstage\.\{\{ \.Values\.platformDomain \}\}\/api\/auth\/oidc\/handler\/frame/,
  );
});

test("the Kubernetes plugin shows each service's Argo CD Application beside its workload, read as the user", async () => {
  const config = JSON.parse(await source("app-config.yaml"));
  assert.deepEqual(config.kubernetes.customResources, [
    { group: "argoproj.io", apiVersion: "v1alpha1", plural: "applications" },
  ]);
  const [cluster] = config.kubernetes.clusterLocatorMethods[0].clusters;
  assert.equal(cluster.authProvider, "oidc");
  assert.equal("serviceAccountToken" in cluster, false);
});

test("the Argo CD view is read by the signed-in operators group only, never by Backstage's own service account", async () => {
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
  assert.match(binding, /kind: Group\n\s+name: platform-operators/);
  assert.equal(/kind: ServiceAccount/.test(binding), false);
});
