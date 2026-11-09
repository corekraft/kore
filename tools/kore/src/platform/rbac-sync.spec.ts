import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";

test("Gatekeeper syncs the RBAC kinds the kore-rbac constraint reads bindings from", async () => {
  const repository = await loadRepository("local");
  const config = JSON.parse(
    await readFile(
      join(
        repository.root,
        "infra/policies/gatekeeper/constraints/sync/config.yaml",
      ),
      "utf8",
    ),
  );
  assert.equal(config.kind, "Config");
  assert.equal(config.metadata.name, "config");
  assert.equal(config.metadata.namespace, "gatekeeper-system");
  const synced = config.spec.sync.syncOnly.map(
    ({ group, kind }: { group: string; kind: string }) => `${group}/${kind}`,
  );
  assert.deepEqual(synced.sort(), [
    "rbac.authorization.k8s.io/ClusterRole",
    "rbac.authorization.k8s.io/ClusterRoleBinding",
    "rbac.authorization.k8s.io/RoleBinding",
  ]);
  const component = repository.catalog.components.find(
    ({ name }) => name === "kore-policy-constraints",
  )!;
  assert.equal(component.source, "infra/policies/gatekeeper/constraints");
});
