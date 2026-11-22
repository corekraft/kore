import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

const run = promisify(execFile);

async function render(...set: string[]): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "kore-platform-keycloak",
    join(root, "infra/charts/platform-keycloak"),
    "--namespace",
    "keycloak",
    "--set-string",
    "keycloakHostname=keycloak.kore.internal",
    ...set,
  ]);
  return stdout;
}

const keycloak = (stdout: string) =>
  stdout.split(/^---$/m).find((doc) => /^kind: Keycloak$/m.test(doc)) ?? "";

test("with platform-portal on, the Keycloak server enables only client-admin-api:v2, which the operator needs to create the Backstage client", async () => {
  const doc = keycloak(await render("--set", "features.platform-portal=true"));
  assert.match(
    doc,
    /^  features:\n    enabled:\n      - client-admin-api:v2\n(?!      - )/m,
  );
});

test("with platform-portal off, the Keycloak server sets no features, so the flag-off render is unchanged", async () => {
  const doc = keycloak(await render());
  assert.ok(doc.includes("kind: Keycloak"), "the Keycloak CR still renders");
  assert.doesNotMatch(doc, /^  features:/m);
});
