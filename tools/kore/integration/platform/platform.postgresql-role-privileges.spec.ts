import assert from "node:assert/strict";
import { test } from "vitest";
import {
  chart,
  databaseRoutes,
  documents,
  inlineTemplate,
  kind,
  renderStep,
} from "./platform.postgresql-chart-support.js";

// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// What the runtime role (app_dml) may do, read from the composed resources at the PostgreSQL privilege
// level. CREATE, ALTER and DROP follow from ownership and from grants. The composition makes app the
// owner of the database, which owns the public schema (pg_database_owner, PostgreSQL 15 and later),
// and PostgreSQL 15 and later withhold CREATE on that schema from PUBLIC. So app_dml, which owns
// nothing, belongs to no role and gets no grant from the composition, cannot create, alter or drop.
// The privileges the workload needs (SELECT, INSERT and the rest) are granted by the migration, which
// runs as app_ddl, not by the composition. PostgreSQL still grants PUBLIC the TEMP privilege on the
// database, so app_dml can create session-local temporary tables; the composition does not revoke it.

const roleSplit = ["--set", "databaseRoleSplit=true"];

/** The composed Cluster, rendered from the compose step exactly as the function runs it. */
async function composedCluster(set: string[] = []): Promise<string> {
  const out = await renderStep(
    inlineTemplate(await chart(...set), "compose-cloudnative-pg"),
    17,
    undefined,
    undefined,
    "standard",
  );
  const cluster = kind(out, "Cluster");
  assert.ok(cluster, "a Cluster is composed");
  return cluster;
}

/** The documents the role step composes, rendered from its own template. */
async function composedRoles(set: string[] = []): Promise<string> {
  return renderStep(
    inlineTemplate(await chart(...set), "compose-database-roles"),
    17,
    undefined,
    undefined,
    "standard",
  );
}

/** Every resource the flag-on claim composes, as one text: the Cluster, then the role step's documents. */
async function composedResources(): Promise<string> {
  const cluster = await composedCluster(roleSplit);
  const roles = documents(await composedRoles(roleSplit));
  return [cluster, ...roles].join("\n---\n");
}

/** The PostgreSQL major version each compatibility version pins in the composition's image map. */
function pinnedMajors(
  stdout: string,
): { compatibility: string; major: string }[] {
  return [
    ...stdout.matchAll(
      /"(\d+)" "ghcr\.io\/cloudnative-pg\/postgresql:(\d+)\.\d+@sha256:[0-9a-f]+"/g,
    ),
  ].map((match) => ({ compatibility: match[1] ?? "", major: match[2] ?? "" }));
}

/** The lines of one managed role's block in the composed Cluster. */
function roleBlock(cluster: string, name: string): string {
  const block = new RegExp(`- name: ${name}\\n((?: {8}.*\\n)*)`).exec(cluster);
  assert.ok(block, `the ${name} role is declared`);
  return block[1] ?? "";
}

test("every PostgreSQL image the composition pins is 15 or later, the version that withholds CREATE on the public schema from PUBLIC", async () => {
  for (const set of [[], databaseRoutes]) {
    const pins = pinnedMajors(await chart(...set));
    assert.ok(pins.length >= 1, "the composition pins its images by version");
    for (const { compatibility, major } of pins) {
      assert.equal(
        major,
        compatibility,
        `compatibility ${compatibility} pins PostgreSQL ${major}`,
      );
      assert.ok(Number(major) >= 15, `PostgreSQL ${major} is 15 or later`);
    }
  }
});

test("with the flag on the runtime role owns nothing and belongs to no role, and the database stays owned by the app role", async () => {
  const cluster = await composedCluster(roleSplit);
  const stdout = await composedResources();
  // inRoles on a role lists the roles it joins, so app_dml must list none, and no role may list app_dml.
  assert.doesNotMatch(
    roleBlock(cluster, "app_dml"),
    /inRoles/,
    "app_dml joins no role",
  );
  assert.doesNotMatch(
    stdout,
    /inRoles: \[[^\]]*app_dml/,
    "no role joins app_dml, so none inherits its rights",
  );
  assert.doesNotMatch(
    stdout,
    /owner: app_dml|OWNER TO app_dml/,
    "no object is owned by app_dml",
  );
  assert.match(
    stdout,
    /bootstrap: \{initdb: \{database: app, owner: app\}\}/,
    "the database and its owner are the app role",
  );
});

test("with the flag on the runtime role holds no superuser, role-creating, database-creating, replication or RLS-bypass attribute", async () => {
  const dml = roleBlock(await composedCluster(roleSplit), "app_dml");
  for (const attribute of [
    "superuser",
    "createrole",
    "createdb",
    "replication",
    "bypassrls",
  ]) {
    assert.doesNotMatch(
      dml,
      new RegExp(`${attribute}: true`),
      `app_dml does not set ${attribute}`,
    );
  }
});

test("with the flag on the composition renders no GRANT, REVOKE, default privilege, ownership change or post-init SQL, so the runtime role gets only what the migration grants", async () => {
  assert.doesNotMatch(
    await composedResources(),
    /\b(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES|OWNER TO)\b|postInit/,
  );
});
