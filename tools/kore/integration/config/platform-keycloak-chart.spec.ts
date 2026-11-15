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
  platformPortalFlag,
  validateRepository,
} from "../../src/config/index.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

const run = promisify(execFile);

async function render(environment: string): Promise<string> {
  const root = await findRoot();
  const repository = await loadRepository(environment);
  const values = repository.environment.componentValues?.[
    "kore-platform-keycloak"
  ]?.map((file) => join(root, file));
  assert.equal(values?.length, 1, "one environment values file");
  const { stdout } = await run("helm", [
    "template",
    "kore-platform-keycloak",
    join(root, "infra/charts/platform-keycloak"),
    "--namespace",
    "keycloak",
    "--values",
    values![0]!,
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
    assert.deepEqual(keycloak?.readiness, ["statefulset/keycloak"]);
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
  assert.match(keycloak, /hostname: keycloak\.kore\.local/);
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
