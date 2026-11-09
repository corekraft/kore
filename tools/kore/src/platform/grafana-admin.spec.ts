import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";

async function read(path: string): Promise<string> {
  const repository = await loadRepository("local");
  return readFile(join(repository.root, path), "utf8");
}

test("Grafana reads its admin credentials from a Secret an ExternalSecret owns, never from values", async () => {
  const values = JSON.parse(
    await read("infra/environments/common/values/grafana.yaml"),
  );
  assert.deepEqual(values.admin, {
    existingSecret: "grafana-admin",
    userKey: "admin-user",
    passwordKey: "admin-password",
  });
  assert.equal(values.adminPassword, undefined);
});

test("the admin Secret is generated once in the cluster by External Secrets, so no plaintext reaches git or disk", async () => {
  const template = await read(
    "infra/observability/config/templates/grafana-admin.yaml",
  );
  assert.match(template, /kind: Password\b/);
  assert.match(template, /kind: ExternalSecret\b/);
  assert.match(template, /name: grafana-admin/);
  assert.match(template, /refreshInterval: "0"/);
  assert.match(template, /creationPolicy: Owner/);
  assert.match(template, /admin-password/);
  assert.doesNotMatch(template, /kind: Secret\b/);
});
