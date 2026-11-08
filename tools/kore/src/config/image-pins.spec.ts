import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "./config.js";

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

test("the Policy Controller webhook and lease-cleanup job images come from digest-pinned local values", async () => {
  const root = await findRoot();
  const repository = await loadRepository("local");
  const files =
    repository.environment.componentValues?.["policy-controller"] ?? [];
  assert.equal(files.length, 1, "policy-controller has one values file");
  const values = await readFile(join(root, files[0]!), "utf8");
  const webhook = repository.versions.images["policy-controller"]!;
  const kubectl = repository.versions.images["policy-controller-kubectl"]!;
  const [webhookName, webhookDigest] = webhook.split("@");
  const [webhookRepo, webhookTag] = webhookName!.split(":");
  const [kubectlName, kubectlDigest] = kubectl.split("@");
  const [kubectlRepo, kubectlTag] = kubectlName!.split(":");
  assert.ok(values.includes(`"repository": "${webhookRepo}"`));
  assert.ok(values.includes(`"version": "${webhookTag}@${webhookDigest}"`));
  assert.ok(values.includes(`"repository": "${kubectlRepo}"`));
  assert.ok(values.includes(`"version": "${kubectlTag}@${kubectlDigest}"`));
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
