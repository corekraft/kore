import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { componentValues, findRoot, loadRepository } from "./config.js";

/** No GIT_* variable: under a git hook GIT_DIR names the real repository, which git would read (#368). */
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

const DIGEST = /@sha256:[0-9a-f]{64}$/;

// The locally built reference image is the only entry allowed without a digest.
const NOT_YET_DIGEST_PINNED = new Set(["reference"]);

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

test("the PostgreSQL composition pins every supported operand version by an approved digest", async () => {
  const root = await findRoot();
  const repository = await loadRepository("local");
  const composition = await readFile(
    join(root, "infra/apis/postgresql/compositions/local.yaml"),
    "utf8",
  );
  const definition = await readFile(
    join(root, "infra/apis/postgresql/definitions/postgresqlinstance.yaml"),
    "utf8",
  );
  const supported =
    /compatibilityVersion: \{ type: integer, enum: \[([\d, ]+)\]/
      .exec(definition)?.[1]
      ?.split(",")
      .map((version) => version.trim());
  assert.deepEqual(supported, ["16", "17", "18"]);
  const approved = repository.approved.images.map(({ image }) => image);
  for (const version of supported!) {
    const pinned = new RegExp(
      `"${version}" "(ghcr\\.io/cloudnative-pg/postgresql:${version}\\.\\d+@sha256:[0-9a-f]{64})"`,
    ).exec(composition)?.[1];
    assert.ok(pinned, `PostgreSQL ${version} is pinned by digest`);
    assert.ok(approved.includes(pinned), `${pinned} is approved`);
  }
  assert.doesNotMatch(
    composition,
    /imageName: ghcr\.io[^\n]*compatibilityVersion/,
    "the operand image is no longer built from a bare tag",
  );
});

test("every approved image is used: its digest appears in a chart, values file, or composition", async () => {
  const root = await findRoot();
  const repository = await loadRepository("local");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const files = (
    await promisify(execFile)(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "infra"],
      { cwd: root, env: gitEnv },
    )
  ).stdout
    .split("\n")
    .filter(
      (file) =>
        file !== "" &&
        !file.startsWith("infra/plans/") &&
        !file.startsWith("infra/catalog/"),
    );
  const text = (
    await Promise.all(files.map((file) => readFile(join(root, file), "utf8")))
  ).join("\n");
  const unused = repository.approved.images
    .filter(({ image }) => !text.includes(image.split("@sha256:")[1]!))
    .map(({ name }) => name);
  assert.deepEqual(unused, []);
});
