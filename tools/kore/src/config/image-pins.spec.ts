import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { componentValues, findRoot, loadRepository } from "./config.js";

const DIGEST = /@sha256:[0-9a-f]{64}$/;

// Images built locally (reference) or still tag-only (opa-envoy, tracked in the
// plan) are the only entries allowed without a digest.
const NOT_YET_DIGEST_PINNED = new Set(["reference", "opa-envoy"]);

test("every platform image in the version catalog is pinned tag@sha256 digest", async () => {
  const repository = await loadRepository("local");
  const unpinned = Object.entries(repository.versions.images).filter(
    ([name, ref]) => !NOT_YET_DIGEST_PINNED.has(name) && !DIGEST.test(ref),
  );
  assert.deepEqual(unpinned, []);
  for (const name of [
    "oci-registry",
    "policy-controller",
    "policy-controller-kubectl",
  ]) {
    assert.match(repository.versions.images[name] ?? "", DIGEST, name);
  }
});

test("the registry chart deploys the catalog's tag and digest", async () => {
  const root = await findRoot();
  const repository = await loadRepository("local");
  const values = await readFile(
    join(root, "infra/charts/oci-registry/values.yaml"),
    "utf8",
  );
  const template = await readFile(
    join(root, "infra/charts/oci-registry/templates/all.yaml"),
    "utf8",
  );
  const [nameTag, digest] =
    repository.versions.images["oci-registry"]!.split("@");
  const [repo, tag] = nameTag!.split(":");
  assert.match(values, new RegExp(`repository: ${repo}\\b`));
  assert.match(values, new RegExp(`tag: ${tag!.replace(/\./g, "\\.")}\\b`));
  assert.match(values, new RegExp(`digest: ${digest}\\b`));
  assert.match(template, /\.Values\.image\.digest/);
});

test("every environment receives the digest-pinned Policy Controller webhook and lease-cleanup images", async () => {
  const root = await findRoot();
  for (const name of ["local", "managed-example"]) {
    const repository = await loadRepository(name);
    const component = repository.catalog.components.find(
      (candidate) => candidate.name === "policy-controller",
    )!;
    const files = componentValues(repository, component);
    assert.ok(files.length > 0, `${name}: policy-controller has values`);
    const values = (
      await Promise.all(files.map((file) => readFile(join(root, file), "utf8")))
    ).join("\n");
    for (const key of ["policy-controller", "policy-controller-kubectl"]) {
      const [nameTag, digest] = repository.versions.images[key]!.split("@");
      const [repo, tag] = nameTag!.split(":");
      assert.ok(values.includes(`"repository": "${repo}"`), `${name} ${key}`);
      assert.ok(
        values.includes(`"version": "${tag}@${digest}"`),
        `${name} ${key}`,
      );
    }
  }
});

test("the Cosign CLI has a compatibility row recording its pinned version", async () => {
  const root = await findRoot();
  const repository = await loadRepository("local");
  const matrix = await readFile(
    join(root, "infra/catalog/compatibility.md"),
    "utf8",
  );
  const row = matrix
    .split("\n")
    .find((line) => /^\|\s*Cosign CLI\s*\|/.test(line));
  assert.ok(row, "compatibility.md has a Cosign CLI row");
  assert.ok(row.includes(repository.versions.tools.cosign!));
});
