import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";
import {
  chart,
  databaseRoutes,
  documents,
  inlineTemplate,
  kind,
  renderStep,
} from "./platform.postgresql-chart-support.js";

// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// With database-role-split on, the composed CloudNativePG Cluster declares a DDL role and a DML
// role beside the existing app role. The DDL role is a member of the database owner, so it runs the
// migration; the DML role carries no schema privilege and runs the workload. Each role's password
// comes from a Secret that an External Secrets Password generator creates and refreshes at the
// rotation period; CloudNativePG reloads the role's password from that Secret. Off, every rendered
// object is byte-identical to the golden render of the chart before the flag existed.

const roleSplit = ["--set", "databaseRoleSplit=true"];

const fixture = async (name: string) =>
  readFile(
    join(await findRoot(), "tools/kore/integration/platform/fixtures", name),
    "utf8",
  );

/** Every document of one kind in a rendered stream, in order. */
const all = (stdout: string, name: string): string[] =>
  documents(stdout).filter((doc) =>
    new RegExp(`^kind: ${name}$`, "m").test(doc),
  );

/** The composed Cluster, rendered from the compose step exactly as the function runs it. */
async function composedCluster(set: string[] = []): Promise<string> {
  const template = inlineTemplate(
    await chart(...set),
    "compose-cloudnative-pg",
  );
  const out = await renderStep(template, 17, undefined, undefined, "standard");
  const cluster = kind(out, "Cluster");
  assert.ok(cluster, "a Cluster is composed");
  return cluster;
}

/** The documents the role step composes, rendered from its own template. */
async function composedRoles(set: string[] = []): Promise<string> {
  const template = inlineTemplate(
    await chart(...set),
    "compose-database-roles",
  );
  return renderStep(template, 17, undefined, undefined, "standard");
}

/** The rendered rbac chart, with the same flag the composition is given. */
async function rbac(set: string[] = []): Promise<string> {
  const { stdout } = await promisify(execFile)("helm", [
    "template",
    "rbac",
    join(await findRoot(), "infra/charts/crossplane-postgresql-rbac"),
    ...set,
  ]);
  return stdout;
}

test("with the flag off the PostgreSQL API renders byte-identical to the golden flag-off render", async () => {
  assert.equal(await chart(), await fixture("postgresql-api-flag-off.yaml"));
});

test("with the flag off and database-routes on the PostgreSQL API renders byte-identical to the golden flag-off render", async () => {
  assert.equal(
    await chart(...databaseRoutes),
    await fixture("postgresql-api-routes-flag-off.yaml"),
  );
});

test("with the flag off the RBAC chart renders byte-identical to the golden flag-off render", async () => {
  assert.equal(
    await rbac(),
    await fixture("crossplane-postgresql-rbac-flag-off.yaml"),
  );
});

test("with the flag off the Cluster declares no managed roles and keeps the app owner", async () => {
  const cluster = await composedCluster();
  assert.doesNotMatch(cluster, /managed:/);
  assert.match(cluster, /bootstrap: \{initdb: \{database: app, owner: app\}\}/);
});

test("with the flag off no role step, password generator or ExternalSecret is composed", async () => {
  const stdout = await chart();
  assert.doesNotMatch(
    stdout,
    /compose-database-roles|kind: Password|kind: ExternalSecret/,
  );
});

test("with the flag on the Cluster keeps the app owner, and the connection Secret still names the app role", async () => {
  const set = roleSplit;
  const cluster = await composedCluster(set);
  assert.match(cluster, /bootstrap: \{initdb: \{database: app, owner: app\}\}/);
  const out = await renderStep(
    inlineTemplate(await chart(...set), "compose-cloudnative-pg"),
    17,
    undefined,
    undefined,
    "standard",
  );
  assert.match(out, /username: app\n {2}passwordSecretRef: orders-db-app/);
});

test("with the flag on the DDL role is a member of the owner, with its password from its own Secret", async () => {
  const cluster = await composedCluster(roleSplit);
  assert.match(
    cluster,
    /managed:\n {4}roles:\n {6}- name: app_ddl\n {8}ensure: present\n {8}login: true\n {8}inRoles: \[app\]\n {8}passwordSecret: \{name: orders-db-ddl\}/,
  );
});

test("with the flag on the DML role carries no schema privilege, no membership and no ownership", async () => {
  const cluster = await composedCluster(roleSplit);
  const dml = /- name: app_dml\n((?: {8}.*\n)*)/.exec(cluster);
  assert.ok(dml, "the DML role is declared");
  assert.deepEqual(
    dml[1]
      ?.trimEnd()
      .split("\n")
      .map((line) => line.trim()),
    ["ensure: present", "login: true", "passwordSecret: {name: orders-db-dml}"],
  );
});

test("with the flag on each role's password is generated by a Password generator and rotated at the rotation period", async () => {
  const stdout = await composedRoles(roleSplit);
  const generators = all(stdout, "Password");
  assert.equal(generators.length, 2, "one generator per role");
  for (const role of ["ddl", "dml"]) {
    const generator = generators.find((doc) =>
      doc.includes(`name: orders-db-${role}-password`),
    );
    assert.ok(generator, `a generator for ${role} is composed`);
    assert.match(
      generator,
      /apiVersion: generators\.external-secrets\.io\/v1alpha1/,
    );
    assert.match(generator, /length: 48/);
  }
});

test("with the flag on each role's ExternalSecret refreshes at the rotation period and writes a basic-auth Secret the operator reloads", async () => {
  const stdout = await composedRoles(roleSplit);
  const secrets = all(stdout, "ExternalSecret");
  assert.equal(secrets.length, 2, "one ExternalSecret per role");
  for (const [role, username] of [
    ["ddl", "app_ddl"],
    ["dml", "app_dml"],
  ] as const) {
    const secret = secrets.find((doc) =>
      doc.includes(`  name: orders-db-${role}\n`),
    );
    assert.ok(secret, `an ExternalSecret for ${role} is composed`);
    assert.match(secret, /refreshInterval: 720h/);
    assert.match(
      secret,
      new RegExp(`name: orders-db-${role}-password\\n`),
      "the password comes from the role's generator",
    );
    assert.match(secret, /type: kubernetes\.io\/basic-auth/);
    assert.match(secret, new RegExp(`username: ${username}\\n`));
    assert.match(secret, /cnpg\.io\/reload: "true"/);
    assert.match(secret, /password: "\{\{ \.password \}\}"/);
  }
});

test("with the flag on only the password generators are forced Ready, so a claim reports Ready only once each role's Secret exists", async () => {
  const stdout = await composedRoles(roleSplit);
  for (const doc of all(stdout, "Password")) {
    assert.match(doc, /gotemplating\.fn\.crossplane\.io\/ready: "True"/);
  }
  for (const doc of all(stdout, "ExternalSecret")) {
    assert.doesNotMatch(doc, /gotemplating\.fn\.crossplane\.io\/ready/);
  }
});

test("with the flag on the role Secrets and generators are created in the claim's own namespace", async () => {
  const stdout = await composedRoles(roleSplit);
  const created = [
    ...all(stdout, "ExternalSecret"),
    ...all(stdout, "Password"),
  ];
  assert.equal(created.length, 4);
  for (const doc of created) {
    assert.match(doc, /namespace: orders\n/);
  }
});

test("with the flag on the rotation period is the one the chart sets", async () => {
  const stdout = await composedRoles([
    ...roleSplit,
    "--set-string",
    "databaseRoles.rotationPeriod=168h",
  ]);
  assert.match(stdout, /refreshInterval: 168h/);
  assert.doesNotMatch(stdout, /refreshInterval: 720h/);
});

test("with the flag on and database-routes on, the Cluster keeps its route target and carries the managed roles", async () => {
  const set = [...databaseRoutes, ...roleSplit];
  const cluster = await composedCluster(set);
  assert.match(cluster, /managed:\n {4}roles:/);
  assert.match(cluster, /bootstrap: \{initdb: \{database: app, owner: app\}\}/);
  const out = await renderStep(
    inlineTemplate(await chart(...set), "compose-cloudnative-pg"),
    17,
    undefined,
    undefined,
    "standard",
  );
  assert.match(out, /backendRefs:\n\s+- name: orders-db-rw\n\s+port: 5432/);
  const roles = await composedRoles(set);
  assert.equal(all(roles, "ExternalSecret").length, 2);
});

test("the flag changes the composition, and both the local and the database-routes variants gain the same role step", async () => {
  const off = await chart();
  const on = await chart(...roleSplit);
  assert.notEqual(on, off);
  assert.match(on, /- step: compose-database-roles/);
  assert.match(on, /managed:/);
  const routesOn = await chart(...databaseRoutes, ...roleSplit);
  assert.match(routesOn, /- step: compose-database-roles/);
  assert.match(routesOn, /managed:/);
});

test("with the flag on the RBAC role may create and update External Secrets and password generators, and no Secret", async () => {
  const stdout = await rbac(roleSplit);
  assert.match(stdout, /apiGroups: \[external-secrets\.io\]/);
  assert.match(stdout, /apiGroups: \[generators\.external-secrets\.io\]/);
  assert.match(stdout, /resources: \[externalsecrets\]/);
  assert.match(stdout, /resources: \[passwords\]/);
  assert.equal(
    stdout.split("resources: [secrets]").length,
    (await rbac()).split("resources: [secrets]").length,
    "the Secret rule is the one the chart always carries, and no new one",
  );
});

test("with the flag off the RBAC role gains no External Secrets rule", async () => {
  assert.doesNotMatch(await rbac(), /external-secrets/);
});
