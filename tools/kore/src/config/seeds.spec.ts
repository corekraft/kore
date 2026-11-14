// Docs: docs/decisions/0033-platform-image-mirror.md (ADR 0033, seeds and evidence)
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { evidenceErrors, seedErrors } from "./seeds.js";
import type { Component, Repository } from "./types.js";
import {
  fakeCatalog,
  fakeComponent,
  fakeEnvironment,
  fakeEvidence,
  fakeRepository,
  fakeSeed,
  fakeSeeds,
  fakeVersions,
  malformed,
} from "./config-support.js";

vi.mock("node:fs/promises");
vi.mock("node:path");

const digest = "a".repeat(64);
const image = `docker.io/library/registry:2@sha256:${digest}`;
const issuer = "https://token.actions.githubusercontent.com";

/** A repository whose files are the given text, by path relative to the root. */
function repositoryWith(options: {
  seeds?: unknown;
  components?: Component[];
  images?: Record<string, string>;
  files?: Record<string, string>;
}): Repository {
  vi.mocked(readFile).mockImplementation(async (path) => {
    // The unit only reads string paths, built by join, so the cast is exact.
    const text = (options.files ?? {})[path as string];
    if (text === undefined) {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
    return text;
  });
  return fakeRepository({
    seeds: options.seeds === undefined ? fakeSeeds() : fakeSeeds(options.seeds),
    catalog: fakeCatalog(
      options.components ?? [
        fakeComponent({
          name: "kore-registry",
          kind: "manifest",
          values: ["infra/values.yaml"],
        }),
      ],
    ),
    versions: fakeVersions({}, options.images ?? { registry: image }),
    environment: fakeEnvironment({ componentValues: {} }),
  });
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
});

test("evidence with a method, a source, a checked date and unsigned provenance has no errors", () => {
  expect(evidenceErrors("seed x", fakeEvidence())).toEqual([]);
});

test("evidence without provenance, method, source or a dated check names each missing part", () => {
  expect(evidenceErrors("seed x", malformed({ checked: "last week" }))).toEqual(
    [
      "seed x: evidence.provenance is required: {signed: false} or {signed: true, issuer, identity}",
      "seed x: evidence.method is required",
      "seed x: evidence.source is required (upstream verification)",
      "seed x: evidence.checked must be a YYYY-MM-DD date",
    ],
  );
});

test("signed provenance needs an exact https issuer and an exact https URL or email identity", () => {
  const signed = (identity: string, issuerUrl = issuer) =>
    fakeEvidence({
      provenance: { signed: true, issuer: issuerUrl, identity },
    });
  expect(evidenceErrors("seed x", signed("ops@example.com"))).toEqual([]);
  expect(
    evidenceErrors("seed x", signed("https://example.com/release.yaml")),
  ).toEqual([]);
  expect(evidenceErrors("seed x", signed("*@example.com"))).toEqual([
    "seed x: evidence.provenance issuer must be an exact https URL and identity an exact https URL or email (no patterns)",
  ]);
  expect(
    evidenceErrors("seed x", signed("ops@example.com", "http://insecure")),
  ).toEqual([
    "seed x: evidence.provenance issuer must be an exact https URL and identity an exact https URL or email (no patterns)",
  ]);
});

test("a seed list that is not a list is refused before any seed is read", async () => {
  expect(await seedErrors(repositoryWith({ seeds: malformed({}) }))).toEqual([
    "seeds.seeds must be a list (infra/catalog/seeds.yaml): record every seed artifact",
  ]);
});

test("a sound seed, pinned to the catalog image and used by its component, has no errors", async () => {
  const repository = repositoryWith({
    seeds: [fakeSeed({ image })],
    files: { "/repo/infra/values.yaml": `image: sha256:${digest}` },
  });
  expect(await seedErrors(repository)).toEqual([]);
  expect(vi.mocked(readFile).mock.calls).toEqual([
    ["/repo/infra/values.yaml", "utf8"],
  ]);
});

test("a seed naming an unknown component is refused, and no component usage is checked for it", async () => {
  const repository = repositoryWith({
    seeds: [fakeSeed({ image, component: "kore-ghost" })],
  });
  expect(await seedErrors(repository)).toEqual([
    `seed ${image}: unknown component kore-ghost; use a name from infra/catalog/components.yaml`,
  ]);
  expect(vi.mocked(readFile).mock.calls).toEqual([]);
});

test("a seed that differs from its catalog image pin is refused, showing the pin it should match", async () => {
  const other = `docker.io/library/registry:3@sha256:${"b".repeat(64)}`;
  const repository = repositoryWith({
    seeds: [fakeSeed({ image: other })],
    images: { registry: image },
    files: { "/repo/infra/values.yaml": "" },
  });
  const errors = await seedErrors(repository);
  expect(errors).toContain(
    `seed ${other}: does not match versions.images.registry (${image}); update seeds.yaml with the catalog pin`,
  );
});

test("a seed whose digest its component never uses is refused as not used", async () => {
  const repository = repositoryWith({
    seeds: [fakeSeed({ image })],
    files: { "/repo/infra/values.yaml": "image: sha256:unrelated" },
  });
  expect(await seedErrors(repository)).toEqual([
    `seed ${image}: not used by kore-registry; remove it or fix the component`,
  ]);
});

test("an image a component uses, with no seed recorded for it, is reported as unrecorded", async () => {
  const verifier = `docker.io/library/verifier:1@sha256:${"c".repeat(64)}`;
  const repository = repositoryWith({
    seeds: [fakeSeed({ image })],
    images: { registry: image, verifier },
    files: {
      "/repo/infra/values.yaml": `image: sha256:${digest} other: sha256:${"c".repeat(64)}`,
    },
  });
  expect(await seedErrors(repository)).toEqual([
    "unrecorded seed artifact verifier used by kore-registry: add it to infra/catalog/seeds.yaml with a reason and upstream evidence",
  ]);
});

test("a second seed for the same component and catalog image is reported as a duplicate", async () => {
  const repository = repositoryWith({
    seeds: [fakeSeed({ image }), fakeSeed({ image })],
    files: { "/repo/infra/values.yaml": `image: sha256:${digest}` },
  });
  expect(await seedErrors(repository)).toEqual([
    `duplicate seed ${image} for kore-registry`,
  ]);
});

test("a values file that cannot be read for any reason other than not existing is raised, not hidden", async () => {
  const repository = repositoryWith({ seeds: [fakeSeed({ image })] });
  vi.mocked(readFile).mockRejectedValue(
    Object.assign(new Error("denied"), { code: "EACCES" }),
  );
  await expect(seedErrors(repository)).rejects.toThrow("denied");
});

test("a seed missing its catalog image, its reason and a pinned digest names each problem", async () => {
  const repository = repositoryWith({
    seeds: [fakeSeed({ image: "registry:2", catalogImage: "", reason: "" })],
    files: { "/repo/infra/values.yaml": "" },
  });
  const errors = await seedErrors(repository);
  expect(errors).toEqual(
    expect.arrayContaining([
      "seed registry:2: image must be pinned tag@sha256:<digest>",
      "seed registry:2: catalogImage is required",
      "seed registry:2: reason is required (why it cannot be verified first)",
    ]),
  );
});
