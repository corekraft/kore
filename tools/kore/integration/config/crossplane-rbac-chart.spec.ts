import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

const run = promisify(execFile);

async function render(): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "kore-postgresql-rbac",
    join(root, "infra/charts/crossplane-postgresql-rbac"),
  ]);
  return stdout.split(/^---$/m).filter((doc) => /^kind:/m.test(doc));
}

const name = (doc: string) => /^ {2}name: (\S+)$/m.exec(doc)?.[1];

test("no rendered binding grants Crossplane Secrets cluster-wide", async () => {
  const docs = await render();
  const secretRoles = docs
    .filter((doc) => /^kind: ClusterRole$/m.test(doc))
    .filter((doc) => /resources: \[secrets\]/.test(doc))
    .map(name);
  assert.ok(secretRoles.length > 0, "the Secret permission set still exists");
  for (const binding of docs.filter((doc) =>
    /^kind: (Cluster)?RoleBinding$/m.test(doc),
  )) {
    if (/^kind: ClusterRoleBinding$/m.test(binding)) {
      assert.ok(
        !secretRoles.includes(
          /^ {2}name: (\S+)$/m.exec(binding.split("roleRef:")[1] ?? "")?.[1],
        ),
        "a ClusterRoleBinding must not bind a Secret role",
      );
    } else {
      assert.fail("kore app up owns the per-namespace RoleBindings");
    }
  }
});

test("the cluster-wide Crossplane role carries no Secret rule", async () => {
  const docs = await render();
  const bound = docs.find((doc) => /^kind: ClusterRoleBinding$/m.test(doc));
  assert.ok(bound, "composition still binds CNPG permissions");
  const role = docs.find(
    (doc) =>
      /^kind: ClusterRole$/m.test(doc) &&
      name(doc) === "crossplane-postgresql-composition",
  );
  assert.ok(role);
  assert.doesNotMatch(role, /secrets/);
  assert.match(role, /postgresql\.cnpg\.io/);
});

async function renderWith(...set: string[]): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "kore-postgresql-rbac",
    join(root, "infra/charts/crossplane-postgresql-rbac"),
    ...set,
  ]);
  return stdout;
}

const composition = (stdout: string) =>
  stdout
    .split(/^---$/m)
    .find(
      (doc) =>
        /^kind: ClusterRole$/m.test(doc) &&
        /^ {2}name: crossplane-postgresql-composition$/m.test(doc),
    ) ?? "";

test("with databaseRoutes off the composition role's rules are exactly the CloudNativePG rules, as before the flag", async () => {
  assert.equal(
    composition(await renderWith())
      .split("rules:\n")[1]
      ?.trimEnd(),
    [
      "  - apiGroups: [postgresql.cnpg.io]",
      "    resources: [clusters]",
      "    verbs: [get, list, watch, create, update, patch, delete]",
      "  - apiGroups: [postgresql.cnpg.io]",
      "    resources: [clusters/status]",
      "    verbs: [get]",
    ].join("\n"),
  );
});

test("with databaseRoutes on the composition role may manage cert-manager certificates with the cluster verbs and no Secret rule", async () => {
  const role = composition(await renderWith("--set", "databaseRoutes=true"));
  assert.match(
    role,
    /  - apiGroups: \[cert-manager\.io\]\n {4}resources: \[certificates\]\n {4}verbs: \[get, list, watch, create, update, patch, delete\]/,
  );
  assert.doesNotMatch(role, /secrets/);
});
