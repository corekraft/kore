import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "./node-test-shim.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const settings = JSON.parse(
  readFileSync(join(root, ".claude", "settings.json"), "utf8"),
);

test("a permission rule with a mid-pattern wildcard does not end in the literal :* prefix form", () => {
  const rules = [
    ...(settings.permissions?.allow ?? []),
    ...(settings.permissions?.deny ?? []),
    ...(settings.permissions?.ask ?? []),
  ];
  const literal = rules.filter((rule) => {
    const body = rule.match(/^Bash\((.*)\)$/)?.[1];
    return body?.endsWith(":*") && body.slice(0, -2).includes("*");
  });
  assert.deepEqual(literal, []);
});

test("the k3d cluster delete deny rules cover flags before and between the words", () => {
  const deny = settings.permissions?.deny ?? [];
  for (const rule of [
    "Bash(k3d cluster delete:*)",
    "Bash(k3d * cluster delete*)",
    "Bash(k3d cluster * delete*)",
  ]) {
    assert.ok(deny.includes(rule), `missing deny rule ${rule}`);
  }
});
