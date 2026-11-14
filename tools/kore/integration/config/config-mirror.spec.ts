import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { registryHelmArgs } from "../../src/config/registry-address.js";
import { approvedImageList } from "../../src/config/approved.js";
import { findRoot, loadRepository } from "../../src/config/config.js";
import { unmirroredImages } from "../../src/config/mirror.js";

test("managed-example rewrites every approved platform image to the signed mirror", async () => {
  // loadRepository validates, so a missing or drifted rewrite fails the load.
  const repository = await loadRepository("managed-example");
  assert.equal(
    repository.environment.platformMirror,
    "ghcr.io/corekraft/kore/mirror",
  );
  const names = new Set(approvedImageList(repository).map((e) => e.name));
  for (const name of Object.keys(unmirroredImages)) {
    assert.ok(names.has(name), `${name}: exemption names an unknown image`);
  }
});

test("local keeps upstream references and declares no mirror", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.environment.platformMirror, undefined);
});

test("managed admission hands the mirror to the image policy and trusts the release identity that signed it", async () => {
  const repository = await loadRepository("managed-example");
  assert.deepEqual(
    registryHelmArgs(repository.environment, "kore-image-policy"),
    [
      "--set-string",
      "platform.registry.address=registry.example.internal",
      "--set-string",
      "platform.mirror.repository=ghcr.io/corekraft/kore/mirror",
    ],
  );
  const local = await loadRepository("local");
  assert.ok(
    !registryHelmArgs(local.environment, "kore-image-policy").some((arg) =>
      arg.includes("mirror"),
    ),
    "an environment without a mirror passes no mirror value",
  );
  const trust = repository.imageTrustValues?.["trust"] as {
    type: string;
    mode: string;
    subjects: string[];
  };
  assert.equal(trust.type, "keyless");
  assert.equal(trust.mode, "warn");
  assert.ok(
    trust.subjects.includes(
      "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.3.1",
    ),
    "v0.3.1 signed the mirror",
  );
  assert.ok(
    trust.subjects.includes(
      "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.3.2",
    ),
    "v0.3.2 signed the mirror",
  );
  assert.ok(
    trust.subjects.includes(
      "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.4.0",
    ),
    "v0.4.0 signed the mirror, including the Crossplane function packages",
  );
});

test("the image policy chart admits the mirror beside the registry address", async () => {
  const policy = await readFile(
    join(
      await findRoot(),
      "infra/charts/image-policy/templates/clusterimagepolicy.yaml",
    ),
    "utf8",
  );
  assert.match(policy, /\.Values\.platform\.mirror\.repository/);
  assert.match(policy, /\.Values\.platform\.registry\.address/);
});
