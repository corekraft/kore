import assert from "node:assert/strict";
import { test } from "vitest";
import type { ApprovedEntry } from "./approved.js";
import { mirrorRewriteErrors } from "./mirror.js";

const MIRROR = "ghcr.io/corekraft/kore/mirror";
const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;

function approved(name: string, digest: string): ApprovedEntry {
  return {
    name,
    image: `docker.io/example/${name}:1.0@${digest}`,
    evidence: {
      method: "registry-digest",
      source: "test",
      checked: "2026-11-08",
      provenance: { signed: false },
    },
    seed: false,
  };
}

const run = (
  overlays: unknown[],
  exempt: Record<string, string> = {},
  list = [approved("alpha", A), approved("beta", B)],
): string[] =>
  mirrorRewriteErrors({ approved: list, mirror: MIRROR, overlays, exempt });

test("an approved image with no managed rewrite is reported", () => {
  const errors = run([{ alpha: { image: { repository: `${MIRROR}/alpha` } } }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /beta: no managed rewrite/);
});

test("a rewrite that repeats a digest must equal the approved digest", () => {
  const errors = run([
    { image: `${MIRROR}/alpha:1.0@${B}` },
    { image: { repository: `${MIRROR}/beta`, tag: `1.0@${B}` } },
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /alpha.*digest.*differs/);
});

test("a rewrite that names only the repository passes and leaves the digest to its one owner", () => {
  assert.deepEqual(
    run([
      { image: { repository: `${MIRROR}/alpha` } },
      {
        image: {
          registry: "ghcr.io",
          repository: "corekraft/kore/mirror/beta",
        },
      },
    ]),
    [],
  );
});

test("a rewrite of a name that is not approved is reported", () => {
  const errors = run([
    { a: `${MIRROR}/alpha` },
    { b: `${MIRROR}/beta` },
    { c: `${MIRROR}/gamma@${A}` },
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /gamma: not in the approved list/);
});

test("a rewrite to a different mirror host does not count", () => {
  const errors = run([
    { a: "ghcr.io/other/mirror/alpha", b: `${MIRROR}/beta` },
  ]);
  assert.match(errors.join("\n"), /alpha: no managed rewrite/);
});

test("an exempt image needs no rewrite, and a stale exemption is reported", () => {
  assert.deepEqual(
    run([{ a: `${MIRROR}/alpha` }], { beta: "no managed composition" }),
    [],
  );
  const stale = run([{ a: `${MIRROR}/alpha`, b: `${MIRROR}/beta` }], {
    beta: "no managed composition",
  });
  assert.match(
    stale.join("\n"),
    /beta: has a rewrite; remove it from the exemptions/,
  );
});

test("a digest carried beside the repository, in a tag or digest field, is checked too", () => {
  const errors = run([
    { image: { repository: `${MIRROR}/alpha`, tag: `1.0@${B}` } },
    { image: { repository: `${MIRROR}/beta`, digest: A } },
  ]);
  assert.equal(errors.length, 2);
  assert.match(errors.join("\n"), /alpha.*differs/);
  assert.match(errors.join("\n"), /beta.*differs/);
});

test("a package field in a plain manifest counts as a rewrite and its digest is checked", () => {
  const manifest = (digest: string): string =>
    `spec: { package: ${MIRROR}/alpha:v1@${digest} }`;
  const input = (text: string): string[] =>
    mirrorRewriteErrors({
      approved: [approved("alpha", A)],
      mirror: MIRROR,
      overlays: [],
      manifests: [text],
      exempt: {},
    });
  assert.deepEqual(input(manifest(A)), []);
  assert.match(input(manifest(B)).join("\n"), /alpha.*digest.*differs/);
  assert.match(input("spec: {}").join("\n"), /alpha: no managed rewrite/);
});
