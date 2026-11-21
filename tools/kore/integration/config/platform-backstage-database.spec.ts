import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  findRoot,
  loadRepository,
  platformHelmArgs,
} from "../../src/config/index.js";

// Docs: docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md

const run = promisify(execFile);

async function renderDeployment(): Promise<string> {
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
  return (
    stdout.split(/^---$/m).find((part) => /^kind: Deployment$/m.test(part)) ??
    ""
  );
}

test("Backstage keeps the one provisioned database and gives each plugin a schema in it, so it never runs CREATE DATABASE", async () => {
  const deployment = await renderDeployment();
  assert.match(
    deployment,
    /- name: APP_CONFIG_backend_database_pluginDivisionMode\n\s+value: schema\n/,
  );
  assert.match(
    deployment,
    /- name: APP_CONFIG_backend_database_ensureSchemaExists\n\s+value: "true"\n/,
  );
  assert.match(
    deployment,
    /- name: APP_CONFIG_backend_database_connection_database\n\s+valueFrom:\n\s+secretKeyRef:\n\s+name: backstage-db-connection\n\s+key: database\n/,
  );
  assert.equal(
    /pluginDivisionMode\n\s+value: database\b/.test(deployment),
    false,
  );
});
