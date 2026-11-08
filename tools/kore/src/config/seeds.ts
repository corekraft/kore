import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Component, Repository, Seed } from "./types.js";

const digest = /@sha256:[0-9a-f]{64}$/;
const date = /^\d{4}-\d{2}-\d{2}$/;

function fieldErrors(seed: Seed): string[] {
  const label = `seed ${seed.image}`;
  const missing = (value: unknown): boolean =>
    typeof value !== "string" || value.trim() === "";
  return [
    ...(digest.test(seed.image ?? "")
      ? []
      : [`${label}: image must be pinned tag@sha256:<digest>`]),
    ...(missing(seed.catalogImage)
      ? [`${label}: catalogImage is required`]
      : []),
    ...(missing(seed.reason)
      ? [`${label}: reason is required (why it cannot be verified first)`]
      : []),
    ...(missing(seed.evidence?.method)
      ? [`${label}: evidence.method is required`]
      : []),
    ...(missing(seed.evidence?.source)
      ? [`${label}: evidence.source is required (upstream verification)`]
      : []),
    ...(date.test(seed.evidence?.checked ?? "")
      ? []
      : [`${label}: evidence.checked must be a YYYY-MM-DD date`]),
  ];
}

// Files that configure a component's images: its chart defaults (local
// charts), catalog values, and environment overlays.
async function configuredText(
  repository: Repository,
  component: Component,
): Promise<string> {
  const files = [
    ...(component.kind === "local-chart" && component.chart
      ? [join(component.chart, "values.yaml")]
      : []),
    ...(component.values ?? []),
    ...(repository.environment.componentValues?.[component.name] ?? []),
  ];
  const texts = await Promise.all(
    files.map((file) =>
      readFile(join(repository.root, file), "utf8").catch(() => ""),
    ),
  );
  return texts.join("\n");
}

type Texts = Map<string, string>;

async function textFor(
  cache: Texts,
  repository: Repository,
  component: Component,
): Promise<string> {
  const cached = cache.get(component.name);
  if (cached !== undefined) {
    return cached;
  }
  const text = await configuredText(repository, component);
  cache.set(component.name, text);
  return text;
}

function catalogErrors(
  seed: Seed,
  images: Record<string, string>,
  component: Component | undefined,
): string[] {
  const label = `seed ${seed.image}`;
  return [
    ...(component
      ? []
      : [
          `${label}: unknown component ${seed.component}; use a name from infra/catalog/components.yaml`,
        ]),
    ...(images[seed.catalogImage] === seed.image
      ? []
      : [
          `${label}: does not match versions.images.${seed.catalogImage} (${images[seed.catalogImage] ?? "missing"}); update seeds.yaml with the catalog pin`,
        ]),
  ];
}

async function usageErrors(
  repository: Repository,
  seed: Seed,
  component: Component | undefined,
  texts: Texts,
): Promise<string[]> {
  if (!component) {
    return [];
  }
  const text = await textFor(texts, repository, component);
  const imageDigest = seed.image.split("@")[1] ?? "";
  return imageDigest && !text.includes(imageDigest)
    ? [
        `seed ${seed.image}: not used by ${component.name}; remove it or fix the component`,
      ]
    : [];
}

async function unrecordedErrors(
  repository: Repository,
  seeds: Seed[],
  component: Component,
  texts: Texts,
): Promise<string[]> {
  const text = await textFor(texts, repository, component);
  return Object.entries(repository.versions.images ?? {})
    .filter(([key, ref]) => {
      const imageDigest = ref.split("@")[1];
      return (
        imageDigest &&
        text.includes(imageDigest) &&
        !seeds.some(
          (s) => s.component === component.name && s.catalogImage === key,
        )
      );
    })
    .map(
      ([key]) =>
        `unrecorded seed artifact ${key} used by ${component.name}: add it to infra/catalog/seeds.yaml with a reason and upstream evidence`,
    );
}

function duplicateSeedErrors(seeds: Seed[]): string[] {
  return seeds
    .filter(
      (seed, index) =>
        seeds.findIndex(
          (o) =>
            o.component === seed.component &&
            o.catalogImage === seed.catalogImage,
        ) !== index,
    )
    .map((seed) => `duplicate seed ${seed.image} for ${seed.component}`);
}

export async function seedErrors(repository: Repository): Promise<string[]> {
  const seeds = repository.seeds?.seeds;
  if (!Array.isArray(seeds)) {
    return [
      "seeds.seeds must be a list (infra/catalog/seeds.yaml): record every seed artifact",
    ];
  }
  const components = new Map(
    (repository.catalog.components ?? []).map((c) => [c.name, c]),
  );
  const texts: Texts = new Map();
  const images = repository.versions.images ?? {};
  const perSeed = await Promise.all(
    seeds.map(async (seed) => {
      const component = components.get(seed.component);
      return [
        ...fieldErrors(seed),
        ...catalogErrors(seed, images, component),
        ...(await usageErrors(repository, seed, component, texts)),
      ];
    }),
  );
  const seedComponents = [...new Set(seeds.map((seed) => seed.component))]
    .map((name) => components.get(name))
    .filter((component): component is Component => Boolean(component));
  const unrecorded = await Promise.all(
    seedComponents.map((component) =>
      unrecordedErrors(repository, seeds, component, texts),
    ),
  );
  return [
    ...perSeed.flat(),
    ...duplicateSeedErrors(seeds),
    ...unrecorded.flat(),
  ];
}
