import { managedMirrorErrors } from "./mirror.js";
import { evidenceErrors, seedErrors } from "./seeds.js";
import type { Repository, SeedEvidence } from "./types.js";

const digest = /@sha256:[0-9a-f]{64}$/;

/** One image the release mirror may copy, whether a seed or only approved. */
export interface ApprovedEntry {
  name: string;
  image: string;
  evidence: SeedEvidence;
  seed: boolean;
}

/**
 * The full approved list (ADR 0033): the seeds, which stay the bootstrap
 * exception, then the images that are approved but not seeds.
 */
export function approvedImageList(repository: Repository): ApprovedEntry[] {
  return [
    ...repository.seeds.seeds.map((seed) => ({
      name: seed.catalogImage,
      image: seed.image,
      evidence: seed.evidence,
      seed: true,
    })),
    ...repository.approved.images.map((approved) => ({
      name: approved.name,
      image: approved.image,
      evidence: approved.evidence,
      seed: false,
    })),
  ];
}

function duplicates(values: string[]): Set<string> {
  return new Set(values.filter((value, i) => values.indexOf(value) !== i));
}

function approvedErrors(repository: Repository): string[] {
  const images = repository.approved?.images;
  if (!Array.isArray(images)) {
    return [
      "approved.images must be a list (infra/catalog/approved-images.yaml): record every platform image the mirror may copy",
    ];
  }
  const components = new Set(
    (repository.catalog.components ?? []).map((c) => c.name),
  );
  const listed = approvedImageList(repository);
  const repeatedNames = duplicates(listed.map((entry) => entry.name));
  const repeatedImages = duplicates(listed.map((entry) => entry.image));
  return images.flatMap((entry) => {
    const label = `approved image ${entry.image}`;
    return [
      ...evidenceErrors(label, entry.evidence),
      ...(digest.test(entry.image ?? "")
        ? []
        : [`${label}: image must be pinned tag@sha256:<digest>`]),
      ...(typeof entry.name === "string" && entry.name.trim() !== ""
        ? []
        : [`${label}: name is required (the mirror path)`]),
      ...(components.has(entry.component)
        ? []
        : [
            `${label}: unknown component ${entry.component}; use a name from infra/catalog/components.yaml`,
          ]),
      ...(repeatedNames.has(entry.name)
        ? [
            `${label}: duplicate mirror name ${entry.name}; names are unique across seeds and approved images`,
          ]
        : []),
      ...(repeatedImages.has(entry.image)
        ? [`${label}: duplicate image; approve each image once`]
        : []),
    ];
  });
}

/** Problems with the whole approved list: the seeds and the other images. */
export async function imageListErrors(
  repository: Repository,
): Promise<string[]> {
  return [
    ...(await seedErrors(repository)),
    ...approvedErrors(repository),
    // A malformed list is already reported above; there is nothing to rewrite.
    ...(Array.isArray(repository.approved?.images)
      ? await managedMirrorErrors(repository, approvedImageList(repository))
      : []),
  ];
}
