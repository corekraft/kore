import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// With database-role-split on, the reference workload's migration Job connects as the DDL role and
// its api as the DML role. The frontend never sees a database credential. Each consumer carries the
// rotation marker of the role it uses, so rotating one role rolls only the consumers that use it.
// Off, the chart renders byte-identical to the golden flag-off render.

const roleSplit = [
  "--set",
  "database.roleSplit=true",
  "--set-string",
  "database.ddl.secretVersion=ddl-1",
  "--set-string",
  "database.dml.secretVersion=dml-1",
];

async function render(set: string[] = []): Promise<string> {
  const { stdout } = await promisify(execFile)("helm", [
    "template",
    "reference-workload",
    join(await findRoot(), "apps/reference/charts/workload"),
    "--set",
    "platform.gateway.hostname=ref.kore.internal",
    ...set,
  ]);
  return stdout;
}

/** The rendered documents of one kind and name, without helm's source header. */
function document(stdout: string, kind: string, name: string): string {
  const found = stdout
    .split(/^---$/m)
    .find(
      (doc) =>
        new RegExp(`^kind: ${kind}$`, "m").test(doc) &&
        new RegExp(`^  name: ${name}$`, "m").test(doc),
    );
  assert.ok(found, `${kind} ${name} is rendered`);
  return found;
}

/** The env entry of a container, by name, as its rendered text. */
function envEntry(doc: string, name: string): string {
  const entry = doc.split("\n").find((line) => line.includes(`name: ${name},`));
  assert.ok(entry, `${name} is set`);
  return entry;
}

test("with the flag off the reference workload renders byte-identical to the golden flag-off render", async () => {
  assert.equal(
    await render(),
    await readFile(
      join(
        await findRoot(),
        "tools/kore/integration/app/fixtures/reference-workload-flag-off.yaml",
      ),
      "utf8",
    ),
  );
});

test("with the flag on the migration Job connects as the DDL role, with its password from the DDL role's Secret", async () => {
  const job = document(await render(roleSplit), "Job", "reference-migrate");
  assert.match(envEntry(job, "PGUSER"), /name: PGUSER, value: "app_ddl"/);
  assert.match(
    envEntry(job, "PGPASSWORD"),
    /secretKeyRef: \{name: reference-db-ddl, key: password\}/,
  );
  assert.doesNotMatch(job, /reference-db-app/);
});

test("with the flag on the api connects as the DML role, with its password from the DML role's Secret", async () => {
  const api = document(await render(roleSplit), "Deployment", "reference-api");
  assert.match(envEntry(api, "PGUSER"), /name: PGUSER, value: "app_dml"/);
  assert.match(
    envEntry(api, "PGPASSWORD"),
    /secretKeyRef: \{name: reference-db-dml, key: password\}/,
  );
});

test("with the flag on the runtime never carries the DDL role or its Secret", async () => {
  const out = await render(roleSplit);
  for (const name of ["reference-api", "reference-frontend"]) {
    const deployment = document(out, "Deployment", name);
    assert.doesNotMatch(deployment, /app_ddl/, name);
    assert.doesNotMatch(deployment, /reference-db-ddl/, name);
  }
});

test("with the flag on the frontend receives no database credential at all", async () => {
  const frontend = document(
    await render(roleSplit),
    "Deployment",
    "reference-frontend",
  );
  assert.doesNotMatch(frontend, /PGUSER|PGPASSWORD|reference-db-/);
});

test("with the flag on each consumer carries the marker of the role it uses, and rotating one role changes only its consumers", async () => {
  const out = await render(roleSplit);
  const job = document(out, "Job", "reference-migrate");
  assert.match(job, /platform\.kore\.dev\/ddl-secret-version: "?ddl-1"?/);
  assert.doesNotMatch(job, /dml-secret-version/);
  const api = document(out, "Deployment", "reference-api");
  assert.match(api, /platform\.kore\.dev\/dml-secret-version: "?dml-1"?/);
  assert.doesNotMatch(api, /ddl-secret-version/);

  const rotated = await render([
    ...roleSplit.slice(0, 4),
    "--set-string",
    "database.dml.secretVersion=dml-2",
  ]);
  const rotatedApi = document(rotated, "Deployment", "reference-api");
  assert.match(rotatedApi, /dml-secret-version: "?dml-2"?/);
  const rotatedJob = document(rotated, "Job", "reference-migrate");
  assert.match(rotatedJob, /ddl-secret-version: "?ddl-1"?/);
});
