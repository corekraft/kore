import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { manifestImages } from "./manifest-images.js";
import type { ApprovedEntry } from "./approved.js";
import type { Repository } from "./types.js";

/**
 * A managed environment pulls every approved platform image from the release
 * mirror (ADR 0044). The mirror copy is bit-identical, so an overlay rewrites
 * only the image repository; the digest stays where it is already pinned.
 * Charts that take a single `repo:tag@digest` field, or a tag or digest field
 * beside the repository, repeat it, so any digest an overlay carries is
 * checked against the approved one.
 */

export interface MirrorRewriteInput {
  approved: ApprovedEntry[];
  /** Mirror repository prefix, host included (environment.platformMirror). */
  mirror: string;
  /** Parsed values overlays of the environment. */
  overlays: unknown[];
  /** Text of the environment's plain manifests (image and package fields). */
  manifests?: string[];
  /** Approved images with no managed rewrite yet, each with its reason. */
  exempt: Record<string, string>;
}

interface Rewrite {
  name: string;
  digests: string[];
}

const sha = /sha256:[0-9a-f]{64}/g;

/** The image name in `<prefix>/<name>[:tag][@digest]`, with or without the host. */
function nameOf(leaf: string, mirror: string): string | undefined {
  const path = mirror.slice(mirror.indexOf("/") + 1);
  for (const prefix of [mirror, path]) {
    const rest = leaf.startsWith(`${prefix}/`)
      ? leaf.slice(prefix.length + 1)
      : "";
    const name = /^([a-z0-9-]+)(?::[^@\s/]+)?(?:@sha256:[0-9a-f]{64})?$/.exec(
      rest,
    )?.[1];
    if (name) {
      return name;
    }
  }
  return undefined;
}

/** Every rewrite in a value tree, with the digests found in its own object. */
function rewritesIn(value: unknown, mirror: string): Rewrite[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => rewritesIn(item, mirror));
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  const children = Object.values(value);
  const strings = children.filter((c): c is string => typeof c === "string");
  const digests = strings.flatMap((text) => text.match(sha) ?? []);
  const own = strings.flatMap((text) => {
    const name = nameOf(text, mirror);
    return name ? [{ name, digests }] : [];
  });
  return [...own, ...children.flatMap((child) => rewritesIn(child, mirror))];
}

/** Rewrites in a plain manifest: each image or package reference is one. */
function manifestRewrites(mirror: string): (text: string) => Rewrite[] {
  return (text) =>
    manifestImages(text).flatMap((ref) => {
      const name = nameOf(ref, mirror);
      return name ? [{ name, digests: ref.match(sha) ?? [] }] : [];
    });
}

export function mirrorRewriteErrors(input: MirrorRewriteInput): string[] {
  const approved = new Map(input.approved.map((entry) => [entry.name, entry]));
  const rewrites = [
    ...input.overlays.flatMap((overlay) => rewritesIn(overlay, input.mirror)),
    ...(input.manifests ?? []).flatMap(manifestRewrites(input.mirror)),
  ];
  const rewritten = new Set(rewrites.map((rewrite) => rewrite.name));
  const drift = rewrites.flatMap(({ name, digests }) => {
    const pinned = approved.get(name)?.image.split("@")[1];
    return pinned === undefined
      ? []
      : [...new Set(digests)]
          .filter((digest) => digest !== pinned)
          .map(
            (digest) =>
              `${name}: rewrite digest ${digest} differs from the approved digest ${pinned}`,
          );
  });
  return [
    ...input.approved
      .filter(
        (entry) => !rewritten.has(entry.name) && !(entry.name in input.exempt),
      )
      .map(
        (entry) =>
          `${entry.name}: no managed rewrite to ${input.mirror}/${entry.name}; add it to the environment's mirror overlay or record why it is exempt`,
      ),
    ...[...rewritten]
      .filter((name) => !approved.has(name))
      .map(
        (name) =>
          `${name}: not in the approved list; the mirror holds only approved images`,
      ),
    ...drift,
    ...Object.keys(input.exempt)
      .filter((name) => rewritten.has(name))
      .map((name) => `${name}: has a rewrite; remove it from the exemptions`),
  ];
}

/**
 * Approved images a managed environment cannot roll yet. An entry is removed
 * as soon as an overlay rewrites it (the check fails on a stale entry).
 */
export const unmirroredImages: Record<string, string> = {
  "cnpg-postgresql-16":
    "chosen by the local PostgreSQL composition's image table; no managed composition exists yet",
  "cnpg-postgresql-17":
    "chosen by the local PostgreSQL composition's image table; no managed composition exists yet",
  "cnpg-postgresql-18":
    "chosen by the local PostgreSQL composition's image table; no managed composition exists yet",
};

/** The YAML text under an environment's own manifest source directory. */
function manifestText(
  repository: Repository,
): (source: string) => Promise<string[]> {
  return async (source) => {
    const root = join(repository.root, source);
    try {
      const names = await readdir(root, { recursive: true });
      return await Promise.all(
        names
          .filter((name) => /\.ya?ml$/.test(name))
          .map(async (name) => readFile(join(root, name), "utf8")),
      );
    } catch {
      return []; // a missing directory is reported elsewhere
    }
  };
}

/** Overlay and approved-list problems of an environment that declares a mirror. */
export async function managedMirrorErrors(
  repository: Repository,
  approved: ApprovedEntry[],
): Promise<string[]> {
  const mirror = repository.environment.platformMirror;
  if (mirror === undefined) {
    return [];
  }
  const files = [
    ...new Set(
      Object.values(repository.environment.componentValues ?? {}).flat(),
    ),
  ];
  const overlays = await Promise.all(
    files.map(async (file) => {
      try {
        return JSON.parse(await readFile(join(repository.root, file), "utf8"));
      } catch {
        return undefined; // missing or unparseable files are reported elsewhere
      }
    }),
  );
  const manifests = await Promise.all(
    Object.values(repository.environment.componentSources ?? {}).map(
      manifestText(repository),
    ),
  );
  return mirrorRewriteErrors({
    approved,
    mirror,
    overlays,
    manifests: manifests.flat(),
    exempt: unmirroredImages,
  });
}
