// Docs: docs/decisions/0044-managed-platform-images-from-the-mirror.md
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { ApprovedEntry } from "./approved.js";
import { fakeEnvironment, fakeRepository } from "./config-support.js";
import { manifestImages } from "./manifest-images.js";
import { managedMirrorErrors, mirrorRewriteErrors } from "./mirror.js";

vi.mock("node:fs/promises");
vi.mock("node:path");
vi.mock("./manifest-images.js");

// readdir is overloaded; the typed view is the one the manifest reader calls.
const listDir =
  vi.mocked<
    (path: string, options?: { recursive?: boolean }) => Promise<string[]>
  >(readdir);

const MIRROR = "ghcr.io/corekraft/kore/mirror";
const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
});

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

test("a package field in a plain manifest counts as a rewrite, and its digest is checked", () => {
  const manifest = `spec: { package: ${MIRROR}/alpha:v1@${B} }`;
  vi.mocked(manifestImages).mockReturnValue([`${MIRROR}/alpha:v1@${B}`]);
  const errors = mirrorRewriteErrors({
    approved: [approved("alpha", A)],
    mirror: MIRROR,
    overlays: [],
    manifests: [manifest],
    exempt: {},
  });
  expect(manifestImages).toHaveBeenCalledExactlyOnceWith(manifest);
  assert.match(errors.join("\n"), /alpha.*digest.*differs/);
});

test("a plain manifest whose references are all matched by an approved digest passes", () => {
  vi.mocked(manifestImages).mockReturnValue([`${MIRROR}/alpha:v1@${A}`]);
  expect(
    mirrorRewriteErrors({
      approved: [approved("alpha", A)],
      mirror: MIRROR,
      overlays: [],
      manifests: ["spec: {}"],
      exempt: {},
    }),
  ).toEqual([]);
});

// managedMirrorErrors reads the environment's overlays and manifest sources.

const files: Record<string, string> = {};

function environment(
  componentValues: Record<string, string[]> = {},
  componentSources: Record<string, string> = {},
) {
  return fakeRepository({
    root: "/repo",
    environment: fakeEnvironment({
      platformMirror: MIRROR,
      componentValues,
      componentSources,
    }),
  });
}

beforeEach(() => {
  for (const key of Object.keys(files)) {
    delete files[key];
  }
  vi.mocked(readFile).mockImplementation(async (path) => {
    const text = typeof path === "string" ? files[path] : undefined;
    if (text === undefined) {
      throw new Error("ENOENT");
    }
    return text;
  });
});

const overlayJson = (repository: string) =>
  JSON.stringify({ alpha: { image: { repository } } });

test("an environment with no platform mirror reads nothing and reports nothing", async () => {
  expect(
    await managedMirrorErrors(fakeRepository(), [approved("alpha", A)]),
  ).toEqual([]);
  expect(readFile).not.toHaveBeenCalled();
});

test("a managed environment's overlays are read from the repository root and checked for rewrites", async () => {
  files["/repo/env/ui.json"] = overlayJson(`${MIRROR}/alpha`);
  const errors = await managedMirrorErrors(
    environment({ "kore-ui": ["env/ui.json"] }),
    [approved("alpha", A), approved("beta", B)],
  );
  expect(readFile).toHaveBeenCalledWith("/repo/env/ui.json", "utf8");
  expect(errors).toEqual([
    "beta: no managed rewrite to ghcr.io/corekraft/kore/mirror/beta; add it to the environment's mirror overlay or record why it is exempt",
  ]);
});

test("an overlay shared by two components is read once", async () => {
  files["/repo/env/shared.json"] = overlayJson(`${MIRROR}/alpha`);
  await managedMirrorErrors(
    environment({
      "kore-ui": ["env/shared.json"],
      "kore-api": ["env/shared.json"],
    }),
    [approved("alpha", A)],
  );
  expect(readFile).toHaveBeenCalledTimes(1);
});

test("an overlay that is missing or not JSON is skipped, so the rewrites it held count as absent", async () => {
  files["/repo/env/broken.json"] = "{ not json";
  const errors = await managedMirrorErrors(
    environment({ "kore-ui": ["env/missing.json", "env/broken.json"] }),
    [approved("alpha", A)],
  );
  expect(errors).toEqual([
    "alpha: no managed rewrite to ghcr.io/corekraft/kore/mirror/alpha; add it to the environment's mirror overlay or record why it is exempt",
  ]);
});

test("the YAML under a component's manifest source is read, and other files are not", async () => {
  files["/repo/manifests/policy/policy.yaml"] = `image: ${MIRROR}/alpha@${A}`;
  files["/repo/manifests/policy/nested/rbac.yml"] = "kind: Role";
  listDir.mockResolvedValue(["policy.yaml", "notes.txt", "nested/rbac.yml"]);
  vi.mocked(manifestImages).mockReturnValue([`${MIRROR}/alpha@${A}`]);
  const errors = await managedMirrorErrors(
    environment({}, { "kore-policy": "manifests/policy" }),
    [approved("alpha", A)],
  );
  expect(readdir).toHaveBeenCalledWith("/repo/manifests/policy", {
    recursive: true,
  });
  expect(readFile).toHaveBeenCalledWith(
    "/repo/manifests/policy/policy.yaml",
    "utf8",
  );
  expect(readFile).toHaveBeenCalledWith(
    "/repo/manifests/policy/nested/rbac.yml",
    "utf8",
  );
  expect(readFile).toHaveBeenCalledTimes(2);
  expect(errors).toEqual([]);
});

test("a missing manifest source adds no rewrite, and its absence is reported elsewhere", async () => {
  listDir.mockRejectedValue(new Error("ENOENT"));
  const errors = await managedMirrorErrors(
    environment({}, { "kore-policy": "manifests/gone" }),
    [approved("alpha", A)],
  );
  expect(manifestImages).not.toHaveBeenCalled();
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatch(/^alpha: no managed rewrite/);
});
