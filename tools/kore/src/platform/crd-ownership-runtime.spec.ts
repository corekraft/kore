import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { crdGroupErrors, crdOwners, loadRepository } from "../config/index.js";

// Docs: docs/decisions/0057-runtime-crd-ownership.md

test("the catalog's group claims do not overlap and every Gatekeeper template CRD has one owner", async () => {
  const repository = await loadRepository("local");
  const components = repository.catalog.components;
  assert.deepEqual(crdGroupErrors(components), []);

  const dir = join(repository.root, "infra/policies/gatekeeper/templates");
  for (const file of await readdir(dir)) {
    const kind = /names:\s*\{\s*kind:\s*(\w+)/.exec(
      await readFile(join(dir, file), "utf8"),
    )?.[1];
    assert.ok(kind, `${file} declares a constraint kind`);
    const crd = `${kind.toLowerCase()}.constraints.gatekeeper.sh`;
    assert.deepEqual(
      crdOwners(components, crd),
      ["kore-policy-templates"],
      `${crd} from ${file}`,
    );
  }
});

test("Crossplane package CRDs and Function input CRDs each have one owner", async () => {
  const { catalog } = await loadRepository("local");
  const owners = (crd: string) => crdOwners(catalog.components, crd);
  assert.deepEqual(owners("functions.pkg.crossplane.io"), ["crossplane"]);
  assert.deepEqual(owners("providers.pkg.crossplane.io"), ["crossplane"]);
  assert.deepEqual(owners("compositions.apiextensions.crossplane.io"), [
    "crossplane",
  ]);
  assert.deepEqual(owners("gotemplates.gotemplating.fn.crossplane.io"), [
    "kore-crossplane-functions",
  ]);
});

test("every Gateway API CRD the standard install applies is owned by kore-gateway-api", async () => {
  const { catalog } = await loadRepository("local");
  // Found unowned on the live profile (2026-11-08): the standard install
  // carries more CRDs than the three the readiness checks name.
  for (const plural of [
    "backendtlspolicies",
    "grpcroutes",
    "listenersets",
    "referencegrants",
    "tcproutes",
    "tlsroutes",
    "udproutes",
    "httproutes",
  ]) {
    assert.deepEqual(
      crdOwners(catalog.components, `${plural}.gateway.networking.k8s.io`),
      ["kore-gateway-api"],
      plural,
    );
  }
});
