import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/config.js";

const run = promisify(execFile);

async function render(...set: string[]): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "kore-admission-gate",
    join(root, "infra/charts/admission-gate"),
    ...set,
  ]);
  return stdout.split(/^---$/m).filter((doc) => /^kind:/m.test(doc));
}

const bound = (docs: string[]) =>
  docs.filter((doc) => /^kind: (Cluster)?RoleBinding$/m.test(doc));

test("only the bootstrap group is bound to the gate, activation, and signing-key roles", async () => {
  const bindings = bound(await render());
  assert.equal(bindings.length, 3);
  for (const binding of bindings) {
    assert.match(binding, /kind: Group\n\s+name: "kore:bootstrap"/);
    assert.doesNotMatch(binding, /kind: (User|ServiceAccount)/);
  }
});

test("a configured bootstrap group replaces the default, never adds a broader subject", async () => {
  const bindings = bound(
    await render("--set-json", 'bootstrapGroups=["ci:bootstrap"]'),
  );
  for (const binding of bindings) {
    assert.match(binding, /name: "ci:bootstrap"/);
    assert.doesNotMatch(binding, /kore:bootstrap/);
  }
});

test("the signing key is readable only by name and only through the signing-path role", async () => {
  const docs = await render();
  const role = docs.find((doc) => /^kind: Role$/m.test(doc))!;
  assert.match(role, /resourceNames: \["kore-local-signing-key"\]/);
  assert.doesNotMatch(role, /verbs: \[[^\]]*(list|watch|\*)/);
  assert.doesNotMatch(docs.join("\n"), /resources: \[[^\]]*\*/);
  const reads = role
    .split(/\n  - /)
    .filter((rule) => /get/.test(rule) && /secrets/.test(rule));
  assert.ok(reads.length > 0);
  for (const rule of reads) {
    assert.match(rule, /resourceNames/);
  }
});

test("editing or deleting the gate is limited to the gate itself and never to namespaces", async () => {
  const cluster = (await render()).find((doc) =>
    /^kind: ClusterRole$/m.test(doc),
  )!;
  const gate = cluster
    .split(/\n  - /)
    .filter((rule) => /koreapplicationadmission/.test(rule));
  const mutates = gate.filter((rule) => /update|patch|delete/.test(rule));
  assert.ok(mutates.length > 0);
  for (const rule of mutates) {
    assert.match(rule, /resourceNames: \[kore-application-admission\]/);
  }
  const namespaces = cluster
    .split(/\n  - /)
    .find((rule) => /resources: \[namespaces\]/.test(rule))!;
  assert.doesNotMatch(namespaces, /delete/);
});

test("readiness evidence is writable only by bootstrap, by name, and never deletable", async () => {
  const docs = await render();
  const role = docs.find(
    (doc) =>
      /name: kore-readiness-evidence\n\s+namespace/.test(doc) &&
      /^kind: Role$/m.test(doc),
  )!;
  assert.ok(role, "an evidence Role exists");
  assert.match(role, /namespace: kore-system/);
  assert.match(role, /resourceNames: \[kore-platform-readiness\]/);
  assert.doesNotMatch(role, /(verbs|resources): \[[^\]]*(delete|\*)/);
  const binding = docs.find(
    (doc) =>
      /^kind: RoleBinding$/m.test(doc) && /kore-readiness-evidence/.test(doc),
  )!;
  assert.match(binding, /kind: Group\n\s+name: "kore:bootstrap"/);
});
