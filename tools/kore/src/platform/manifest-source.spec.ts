import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { manifestSource } from "./helm.js";

test("a managed environment applies its own source for a manifest component and local keeps the shared one", async () => {
  const name = "kore-crossplane-functions";
  const local = await loadRepository("local");
  const managed = await loadRepository("managed-example");
  const component = (repo: typeof local) =>
    repo.catalog.components.find((c) => c.name === name)!;
  assert.equal(
    manifestSource(local, component(local)),
    join(local.root, "infra/apis/crossplane-functions"),
  );
  assert.equal(
    manifestSource(managed, component(managed)),
    join(
      managed.root,
      "infra/environments/managed-example/manifests/crossplane-functions",
    ),
  );
});
