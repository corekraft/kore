import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
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

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

const run = promisify(execFile);

async function render(
  environment: string,
  set: string[] = [],
): Promise<string> {
  const root = await findRoot();
  const repository = await loadRepository(environment);
  const { stdout } = await run("helm", [
    "template",
    "kore-platform-keycloak",
    join(root, "infra/charts/platform-keycloak"),
    "--namespace",
    "keycloak",
    ...platformHelmArgs(repository.environment, "kore-platform-keycloak"),
    ...set,
  ]);
  return stdout;
}

const document = (rendered: string, kind: string): string =>
  rendered.split(/^---$/m).find((part) => part.includes(`kind: ${kind}`)) ?? "";

test("the platform Keycloak is a flag-gated chart installed after its operator and the PostgreSQL API, so with the flag off nothing reaches a cluster", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = await loadRepository(name);
    await validateRepository(repository);
    const keycloak = repository.catalog.components.find(
      (c) => c.name === "kore-platform-keycloak",
    );
    assert.equal(keycloak?.featureFlag, platformPortalFlag);
    assert.equal(keycloak?.kind, "local-chart");
    assert.equal(keycloak?.namespace, "keycloak");
    assert.deepEqual(keycloak?.ownsCRDs, []);
    assert.ok(keycloak?.dependencies.includes("keycloak-operator"));
    assert.ok(keycloak?.dependencies.includes("kore-postgresql-api"));
    assert.deepEqual(keycloak?.readiness, [
      "statefulset/keycloak",
      "organization.platform.kore.dev/platform",
    ]);
    assert.ok(keycloak?.dependencies.includes("kore-platform-apis"));
    const installed = enabledComponents(repository).map((c) => c.name);
    assert.equal(installed.includes("kore-platform-keycloak"), false);
    const order = orderedComponents(repository.catalog).map((c) => c.name);
    assert.ok(
      order.indexOf("keycloak-operator") <
        order.indexOf("kore-platform-keycloak"),
    );
  }
});

test("the database is claimed through the platform PostgreSQL API with Retain, so a down or an upgrade keeps the realm data", async () => {
  const claim = document(await render("local"), "PostgreSQLInstance");
  assert.match(claim, /apiVersion: platform\.kore\.dev\/v1alpha1/);
  assert.match(claim, /name: keycloak-db\n/);
  assert.match(claim, /namespace: keycloak/);
  assert.match(claim, /retentionPolicy: Retain/);
  assert.match(claim, /connectionSecretName: keycloak-db-connection/);
});

test("the Keycloak reads its database credentials and bootstrap admin from Secrets by reference, so no credential is in git", async () => {
  const keycloak = document(await render("local"), "Keycloak");
  assert.match(keycloak, /apiVersion: k8s\.keycloak\.org\/v2beta1/);
  assert.match(keycloak, /host: keycloak-db-rw/);
  assert.match(keycloak, /name: keycloak-db-app/);
  assert.match(keycloak, /secret: keycloak-admin/);
  assert.match(
    keycloak,
    new RegExp(`hostname: keycloak\\.${escapeRegExp(platform.domain)}`),
  );
  assert.equal(/password:\s*\S/i.test(keycloak), false);
  assert.equal(keycloak.includes("image:"), false, "the operator's digest");
});

test("managed-example takes the host from its own platform domain", async () => {
  const keycloak = document(await render("managed-example"), "Keycloak");
  assert.match(keycloak, /hostname: keycloak\.platform\.example\.com/);
});

test("the chart creates no Secret, because kore streams the admin Secret and the platform API creates the database's", async () => {
  const root = await findRoot();
  for (const environment of ["local", "managed-example"]) {
    assert.equal(/kind: Secret\b/.test(await render(environment)), false);
  }
  const chart = await readFile(
    join(root, "infra/charts/platform-keycloak/Chart.yaml"),
    "utf8",
  );
  assert.match(chart, /^name: platform-keycloak$/m);
});

test("the Keycloak-data recovery objective covers the claimed database by data export, with a restore test", async () => {
  const root = await findRoot();
  const { objectives } = JSON.parse(
    await readFile(join(root, "infra/catalog/recovery.yaml"), "utf8"),
  ) as {
    objectives: {
      name: string;
      components: string[];
      protection: string;
      restoreTest?: string;
    }[];
  };
  const objective = objectives.find((o) => o.name === "keycloak-data");
  assert.deepEqual(objective?.components, ["kore-platform-keycloak"]);
  assert.equal(objective?.protection, "data-export");
  assert.match(objective?.restoreTest ?? "", /\.live\.spec\.ts$/);
});

test("the platform Organization claim appears only with platform-portal on, so with the flag off nothing reaches a cluster", async () => {
  const off = await render("local", [
    "--set",
    "features.platform-portal=false",
  ]);
  assert.equal(off.includes("kind: Organization"), false);
  const on = document(
    await render("local", ["--set", "features.platform-portal=true"]),
    "Organization",
  );
  assert.deepEqual(
    on
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("#")),
    [
      "apiVersion: platform.kore.dev/v1alpha1",
      "kind: Organization",
      "metadata:",
      "  name: platform",
      "spec:",
      "  tenant: platform",
    ],
  );
});
