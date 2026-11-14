import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import {
  findRoot,
  loadRepository,
  registryPruneFlag,
} from "../../src/config/index.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

async function read(path: string): Promise<string> {
  return await readFile(join(await findRoot(), path), "utf8");
}

test("the registry accepts manifest deletes only under the registry-tag-pruning flag", async () => {
  const all = await read("infra/charts/oci-registry/templates/all.yaml");
  assert.match(
    all,
    /\{\{-? if index \.Values\.features "registry-tag-pruning" \}\}\n(?:\s*#.*\n)*\s*- \{name: REGISTRY_STORAGE_DELETE_ENABLED, value: "true"\}\s*\n\s*\{\{-? end \}\}/,
  );
  assert.equal(all.match(/REGISTRY_STORAGE_DELETE_ENABLED/g)?.length, 1);
  assert.equal(registryPruneFlag, "registry-tag-pruning");
});

test("the chart defaults the flag to off, so a render without features is unchanged", async () => {
  const values = await read("infra/charts/oci-registry/values.yaml");
  assert.match(
    values,
    /^features:\n(?:\s+#.*\n)*\s+registry-tag-pruning: false$/m,
  );
});

test("the proxy lets only the push identity write, so only it can delete, flag or not", async () => {
  const conf = await read(
    "infra/charts/oci-registry/templates/proxy-config.yaml",
  );
  assert.match(conf, /"~\^1:\(\?!kore-push\$\)\.\+\$" 1;/);
  assert.doesNotMatch(conf, /DELETE/);
  assert.doesNotMatch(conf, /features/);
});

test("the flag is declared off in every environment overlay", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = await loadRepository(name);
    assert.equal(
      repository.environment.features?.[registryPruneFlag],
      false,
      `${name} must declare ${registryPruneFlag} as false`,
    );
  }
});
