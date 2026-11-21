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
import { withGatewayFlagsOff } from "../../src/testing/index.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
// Docs: docs/decisions/0034-registry-authentication-and-authorization.md

const run = promisify(execFile);
const digest =
  "sha256:6c0daf86db540e8d20ebec9e4a981389275a2910eabd17a707945133a7d741ac";

async function render(
  chart: string,
  environment: string,
  component: string,
  flags: string[] = [],
): Promise<string> {
  const root = await findRoot();
  const repository = await loadRepository(environment);
  const values = (
    repository.environment.componentValues?.[component] ?? []
  ).flatMap((file) => ["--values", join(root, file)]);
  const common = repository.catalog.components.find(
    (c) => c.name === component,
  )?.values;
  const { stdout } = await run("helm", [
    "template",
    component,
    join(root, "infra/charts", chart),
    ...(common ?? []).flatMap((file) => ["--values", join(root, file)]),
    ...values,
    ...platformHelmArgs(repository.environment, component),
    ...flags.flatMap((flag) => ["--set", flag]),
  ]);
  return stdout;
}

const document = (rendered: string, kind: string): string =>
  rendered.split(/^---$/m).find((part) => part.includes(`kind: ${kind}`)) ?? "";

test("the provider is a flag-gated core chart that installs after Crossplane and the Keycloak operator, so with the flag off nothing reaches a cluster", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = withGatewayFlagsOff(await loadRepository(name));
    await validateRepository(repository);
    const provider = repository.catalog.components.find(
      (c) => c.name === "keycloak-provider",
    );
    assert.equal(provider?.featureFlag, platformPortalFlag);
    assert.equal(provider?.kind, "local-chart");
    assert.equal(provider?.phase, "core");
    assert.equal(provider?.namespace, "crossplane-system");
    assert.deepEqual(provider?.readiness, [
      "provider.pkg.crossplane.io/provider-keycloak",
    ]);
    for (const group of ["realm", "group"]) {
      assert.ok(
        provider?.ownsCRDGroups?.includes(`${group}.keycloak.m.crossplane.io`),
      );
    }
    assert.equal(
      enabledComponents(repository).some((c) => c.name === "keycloak-provider"),
      false,
    );
    const order = orderedComponents(repository.catalog).map((c) => c.name);
    assert.ok(order.indexOf("crossplane") < order.indexOf("keycloak-provider"));
    assert.ok(
      order.indexOf("keycloak-operator") < order.indexOf("keycloak-provider"),
    );
    assert.ok(
      order.indexOf("keycloak-provider") <
        order.indexOf("kore-platform-keycloak"),
    );
  }
});

test("the provider package is pinned by the approved digest, upstream locally and from the mirror when managed", async () => {
  const local = await render("keycloak-provider", "local", "keycloak-provider");
  const provider = document(local, "Provider");
  assert.match(provider, /apiVersion: pkg\.crossplane\.io\/v1\n/);
  assert.match(provider, /name: provider-keycloak\n/);
  assert.match(
    provider,
    new RegExp(
      `package: xpkg\\.upbound\\.io/crossplane-contrib/provider-keycloak:v3\\.2\\.3@${digest}`,
    ),
  );
  const managed = await render(
    "keycloak-provider",
    "managed-example",
    "keycloak-provider",
  );
  assert.match(
    managed,
    new RegExp(
      `package: ghcr\\.io/corekraft/kore/mirror/provider-keycloak:v3\\.2\\.3@${digest}`,
    ),
  );
  const repository = await loadRepository("local");
  const approved = approvedImageList(repository).find(
    (e) => e.name === "provider-keycloak",
  );
  assert.ok(approved?.image.endsWith(`@${digest}`));
});

test("the ClusterProviderConfig takes the admin credential from the streamed Secret by reference, so no credential is in git", async () => {
  for (const environment of ["local", "managed-example"]) {
    const rendered = await render(
      "platform-keycloak",
      environment,
      "kore-platform-keycloak",
    );
    const config = document(rendered, "ClusterProviderConfig");
    assert.match(config, /apiVersion: keycloak\.m\.crossplane\.io\/v1beta1/);
    assert.match(config, /name: keycloak\n/);
    assert.match(config, /source: Secret/);
    assert.match(config, /name: keycloak-provider-credentials/);
    assert.match(config, /namespace: crossplane-system/);
    assert.match(config, /key: credentials/);
    assert.equal(/password/i.test(config), false);
    assert.equal(/kind: Secret\b/.test(rendered), false);
  }
});

test("the platform Keycloak chart installs after the provider, so the ProviderConfig kind exists", async () => {
  const repository = await loadRepository("local");
  const keycloak = repository.catalog.components.find(
    (c) => c.name === "kore-platform-keycloak",
  );
  assert.ok(keycloak?.dependencies.includes("keycloak-provider"));
});

test("with platform-portal off the Organization composition composes no Keycloak resource, so it is as before", async () => {
  const off = await render("platform-apis", "local", "kore-platform-apis", [
    "features.platform-portal=false",
  ]);
  const unset = await render("platform-apis", "local", "kore-platform-apis");
  assert.equal(off, unset);
  assert.equal(/keycloak/i.test(off), false);
});

const flagOn = ["features.platform-portal=true"];

test("with platform-portal on the Organization owns one realm and the platform-operators group nested under its own group", async () => {
  const on = await render(
    "platform-apis",
    "local",
    "kore-platform-apis",
    flagOn,
  );
  const composition = document(on, "Composition");
  assert.match(composition, /name: organization-local/);
  assert.match(composition, /kind: Realm/);
  assert.match(
    composition,
    /apiVersion: realm\.keycloak\.m\.crossplane\.io\/v1alpha1/,
  );
  assert.match(composition, /namespace: keycloak/);
  assert.match(composition, /realm: platform/);
  assert.match(composition, /kind: ClusterProviderConfig\n\s+name: keycloak/);
  assert.match(
    composition,
    /apiVersion: group\.keycloak\.m\.crossplane\.io\/v1alpha1/,
  );
  assert.match(composition, /name: platform-operators/);
  assert.match(composition, /parentIdRef/);
  assert.match(composition, /realmIdRef/);
  assert.equal((composition.match(/kind: Realm/g) ?? []).length, 1);
});

test("the realm is retained when the Organization is deleted, because it holds users", async () => {
  const on = await render(
    "platform-apis",
    "local",
    "kore-platform-apis",
    flagOn,
  );
  const realm = document(on, "Composition").split("kind: Realm")[1] ?? "";
  const policies =
    /managementPolicies:\s*\n((?:\s+- \w+\n)+)/.exec(realm)?.[1] ?? "";
  assert.match(policies, /- Create/);
  assert.equal(/- Delete/.test(policies), false);
});

test("the group is the one Argo CD binds its operators role to", async () => {
  const values = await readFile(
    join(await findRoot(), "infra/charts/platform-config-delivery/values.yaml"),
    "utf8",
  );
  assert.match(values, /^operatorsGroup: platform-operators$/m);
});

test("the realm is hardened: no self-registration, TLS required for outside clients, explicit short token lifespans and rotating refresh tokens", async () => {
  const on = await render(
    "platform-apis",
    "local",
    "kore-platform-apis",
    flagOn,
  );
  const realm = document(on, "Composition").split("kind: Realm")[1] ?? "";
  const provider = realm.split("kind: Group")[0] ?? "";
  for (const setting of [
    /registrationAllowed: false/,
    /sslRequired: external/,
    /accessTokenLifespan: 5m/,
    /ssoSessionIdleTimeout: 30m/,
    /ssoSessionMaxLifespan: 10h/,
    /revokeRefreshToken: true/,
    /refreshTokenMaxReuse: 0/,
  ]) {
    assert.match(provider, setting);
  }
});

test("the composition creates no user, no client and no wildcard redirect URI or web origin", async () => {
  const on = await render(
    "platform-apis",
    "local",
    "kore-platform-apis",
    flagOn,
  );
  const composition = document(on, "Composition");
  assert.equal(/kind: User\b/.test(composition), false);
  assert.equal(/user\.keycloak/.test(composition), false);
  assert.equal(/kind: (OpenIdClient|Client)\b/.test(composition), false);
  assert.equal(/validRedirectUris|webOrigins/i.test(composition), false);
  assert.equal(
    /\*/.test(composition.split("compose-keycloak-realm")[1] ?? ""),
    false,
  );
});
