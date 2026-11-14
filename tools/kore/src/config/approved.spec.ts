// Docs: docs/decisions/0033-platform-image-mirror.md (ADR 0033, the approved list)
import { beforeEach, expect, test, vi } from "vitest";
import { approvedImageList, imageListErrors } from "./approved.js";
import { managedMirrorErrors } from "./mirror.js";
import { evidenceErrors, seedErrors } from "./seeds.js";
import type { Repository, SeedEvidence } from "./types.js";
import {
  fakeApproved,
  fakeCatalog,
  fakeComponent,
  fakeRepository,
  fakeSeeds,
} from "./config-support.js";

vi.mock("./mirror.js");
vi.mock("./seeds.js");

const digest = `@sha256:${"a".repeat(64)}`;
const evidence = {} as SeedEvidence;
const notAList =
  "approved.images must be a list (infra/catalog/approved-images.yaml): record every platform image the mirror may copy";

function seed(catalogImage: string, image: string) {
  return { catalogImage, image, evidence };
}

function approved(name: string, image: string, component = "kore-registry") {
  return { name, image, component, evidence };
}

/** A repository with only the fields the approved list reads. */
function repositoryWith(
  seeds: unknown[],
  images: unknown,
  components = ["kore-registry", "kore-ui"],
): Repository {
  return fakeRepository({
    seeds: fakeSeeds(seeds),
    approved: fakeApproved(images),
    catalog: fakeCatalog(components.map((name) => fakeComponent({ name }))),
  });
}

beforeEach(() => {
  vi.mocked(seedErrors).mockResolvedValue([]);
  vi.mocked(managedMirrorErrors).mockResolvedValue([]);
  vi.mocked(evidenceErrors).mockReturnValue([]);
});

test("the approved list is the seeds first, then the approved images that are not seeds, each flagged", () => {
  const repository = repositoryWith(
    [seed("kore-registry", `registry:2${digest}`)],
    [approved("kore-ui", `ui:1${digest}`, "kore-ui")],
  );
  expect(approvedImageList(repository)).toEqual([
    {
      name: "kore-registry",
      image: `registry:2${digest}`,
      evidence,
      seed: true,
    },
    { name: "kore-ui", image: `ui:1${digest}`, evidence, seed: false },
  ]);
});

test("an approved list with no seeds and no images is empty", () => {
  expect(approvedImageList(repositoryWith([], []))).toEqual([]);
});

test("the full check runs the seed check, then the approved check, then the mirror check on the whole list", async () => {
  vi.mocked(seedErrors).mockResolvedValue(["seed problem"]);
  vi.mocked(managedMirrorErrors).mockResolvedValue(["mirror problem"]);
  const repository = repositoryWith(
    [seed("kore-registry", `registry:2${digest}`)],
    [approved("kore-ui", `ui:1${digest}`, "kore-ui")],
  );
  expect(await imageListErrors(repository)).toEqual([
    "seed problem",
    "mirror problem",
  ]);
  expect(vi.mocked(seedErrors).mock.calls).toEqual([[repository]]);
  expect(vi.mocked(managedMirrorErrors).mock.calls).toEqual([
    [repository, approvedImageList(repository)],
  ]);
});

test("an approved list that is not a list is reported, and the mirror check is skipped", async () => {
  vi.mocked(seedErrors).mockResolvedValue(["seed problem"]);
  const repository = repositoryWith([], null);
  expect(await imageListErrors(repository)).toEqual(["seed problem", notAList]);
  expect(vi.mocked(managedMirrorErrors).mock.calls).toEqual([]);
});

test("an approved image without a pinned digest is rejected naming the image", async () => {
  const repository = repositoryWith([], [approved("kore-ui", "ui:1.0")]);
  expect(await imageListErrors(repository)).toEqual([
    "approved image ui:1.0: image must be pinned tag@sha256:<digest>",
  ]);
});

test("an approved image without a name is rejected, because the name is its mirror path", async () => {
  const repository = repositoryWith(
    [],
    [approved("  ", `ui:1${digest}`, "kore-ui")],
  );
  expect(await imageListErrors(repository)).toEqual([
    `approved image ui:1${digest}: name is required (the mirror path)`,
  ]);
});

test("an approved image naming a component the catalog does not declare is rejected with the catalog to use", async () => {
  const repository = repositoryWith(
    [],
    [approved("kore-ui", `ui:1${digest}`, "kore-missing")],
  );
  expect(await imageListErrors(repository)).toEqual([
    `approved image ui:1${digest}: unknown component kore-missing; use a name from infra/catalog/components.yaml`,
  ]);
});

test("an approved image whose mirror name a seed already uses is rejected", async () => {
  const repository = repositoryWith(
    [seed("kore-registry", `registry:2${digest}`)],
    [approved("kore-registry", `ui:1${digest}`)],
  );
  expect(await imageListErrors(repository)).toEqual([
    `approved image ui:1${digest}: duplicate mirror name kore-registry; names are unique across seeds and approved images`,
  ]);
});

test("the same image approved twice is rejected on each entry", async () => {
  const repository = repositoryWith(
    [],
    [
      approved("kore-ui", `ui:1${digest}`),
      approved("kore-ui-copy", `ui:1${digest}`),
    ],
  );
  expect(await imageListErrors(repository)).toEqual([
    `approved image ui:1${digest}: duplicate image; approve each image once`,
    `approved image ui:1${digest}: duplicate image; approve each image once`,
  ]);
});

test("evidence problems are reported under the image's own label, from the seeds unit's evidence check", async () => {
  vi.mocked(evidenceErrors).mockReturnValue(["evidence is missing"]);
  const repository = repositoryWith([], [approved("kore-ui", `ui:1${digest}`)]);
  expect(await imageListErrors(repository)).toEqual(["evidence is missing"]);
  expect(vi.mocked(evidenceErrors).mock.calls).toEqual([
    [`approved image ui:1${digest}`, evidence],
  ]);
});
