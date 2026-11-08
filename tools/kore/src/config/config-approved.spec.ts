import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";
import type { ApprovedImage, Repository } from "./types.js";

async function withApproved(
  change: (images: ApprovedImage[]) => ApprovedImage[],
): Promise<Repository> {
  const base = await loadRepository("local");
  return { ...base, approved: { images: change(base.approved.images) } };
}

const first = (images: ApprovedImage[]): ApprovedImage => images[0]!;

test("the approved list records every platform image beyond the seeds, each with evidence and provenance", async () => {
  const { approved, seeds } = await loadRepository("local");
  assert.ok(approved.images.length > 0);
  const seedNames = new Set(seeds.seeds.map((seed) => seed.catalogImage));
  for (const image of approved.images) {
    assert.match(image.image, /@sha256:[0-9a-f]{64}$/, image.name);
    assert.ok(!seedNames.has(image.name), `${image.name} is also a seed`);
    assert.match(image.evidence.checked, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof image.evidence.provenance.signed, "boolean");
  }
});

test("an approved image without a digest is rejected", async () => {
  const repository = await withApproved((images) =>
    images.map((image, i) =>
      i === 0 ? { ...image, image: "registry.example/x:1" } : image,
    ),
  );
  await assert.rejects(
    validateRepository(repository),
    /approved image registry\.example\/x:1.*digest/i,
  );
});

test("an approved image naming an unknown component is rejected", async () => {
  const repository = await withApproved((images) =>
    images.map((image, i) =>
      i === 0 ? { ...image, component: "nope" } : image,
    ),
  );
  await assert.rejects(
    validateRepository(repository),
    /unknown component nope/,
  );
});

test("an approved image without evidence is rejected so the mirror cannot guess", async () => {
  const repository = await withApproved((images) =>
    images.map((image, i) =>
      i === 0
        ? {
            ...image,
            evidence: {
              ...image.evidence,
              source: "",
              provenance: undefined as never,
            },
          }
        : image,
    ),
  );
  await assert.rejects(validateRepository(repository), (error: Error) => {
    assert.match(error.message, /evidence\.source is required/);
    assert.match(error.message, /evidence\.provenance is required/);
    return true;
  });
});

test("an approved image is mirrored under a name no other approved image or seed uses", async () => {
  const dupe = await withApproved((images) => [
    ...images,
    { ...first(images), image: `x/y:1@sha256:${"c".repeat(64)}` },
  ]);
  await assert.rejects(validateRepository(dupe), /duplicate mirror name/);
  const seeded = await withApproved((images) =>
    images.map((image, i) =>
      i === 0 ? { ...image, name: "oci-registry" } : image,
    ),
  );
  await assert.rejects(validateRepository(seeded), /duplicate mirror name/);
});

test("the same image cannot be approved twice under different names", async () => {
  const repository = await withApproved((images) => [
    ...images,
    { ...first(images), name: "another-name" },
  ]);
  await assert.rejects(validateRepository(repository), /duplicate image/);
});

test("a signed approved image may name an exact email identity but never a pattern", async () => {
  const email = await withApproved((images) =>
    images.map((image, i) =>
      i === 0
        ? {
            ...image,
            evidence: {
              ...image.evidence,
              provenance: {
                signed: true,
                issuer: "https://accounts.google.com",
                identity: "releng@example.iam.gserviceaccount.com",
              },
            },
          }
        : image,
    ),
  );
  await validateRepository(email);
  const pattern = await withApproved((images) =>
    images.map((image, i) =>
      i === 0
        ? {
            ...image,
            evidence: {
              ...image.evidence,
              provenance: {
                signed: true,
                issuer: "https://accounts.google.com",
                identity: "https://github.com/a/.*",
              },
            },
          }
        : image,
    ),
  );
  await assert.rejects(validateRepository(pattern), /exact/);
});

test("a missing approved list is rejected", async () => {
  const base = await loadRepository("local");
  await assert.rejects(
    validateRepository({ ...base, approved: undefined as never }),
    /approved\.images must be a list/,
  );
});
