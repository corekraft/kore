/**
 * Finds every image reference a rendered Helm chart can run and checks it
 * against the approved image list (ADR 0033). Rendered output is plain YAML and
 * the CLI has no YAML dependency, so references are found by the few shapes
 * charts use: `image:` fields, `--*-image=` arguments, `*IMAGE*` environment
 * values, and `"image"` keys in embedded JSON values.
 */

export interface NormalizedImage {
  repository: string;
  digest?: string;
}

const imageField = /^[ \t]*-?[ \t]*image:[ \t]*["']?([^"'\s#]+)/gm;
const imageArgument = /^\s*-\s*--[\w-]*image=["']?([^"'\s]+)/gm;
const imageEnvironment =
  /name:\s*["']?(\w*IMAGE\w*)["']?\s+value:\s*["']?([^"'\s]+)/g;
const imagePart = /^(\w*)_IMAGE_(REGISTRY|REPOSITORY|TAG)$/;
const embeddedImage = /"image":\s*"([^"\s]+)"/g;
const helmTestHook = /helm\.sh\/hook"?:\s*"?[^\n]*\btest\b/;

interface Reference {
  index: number;
  ref: string;
}

/**
 * Environment values: one whole image each, except a controller that builds the
 * image it deploys from `<P>_IMAGE_REGISTRY`, `<P>_IMAGE_REPOSITORY` and
 * `<P>_IMAGE_TAG`, which are joined into one reference.
 */
function environmentReferences(document: string): Reference[] {
  const values = [...document.matchAll(imageEnvironment)].map((match) => ({
    index: match.index,
    name: match[1]!,
    value: match[2]!,
  }));
  const parts = new Map<string, Record<string, string>>();
  for (const { name, value } of values) {
    const [, prefix, part] = imagePart.exec(name) ?? [];
    if (prefix !== undefined && part !== undefined) {
      parts.set(prefix, { ...parts.get(prefix), [part]: value });
    }
  }
  const joined = new Set(
    [...parts].flatMap(([prefix, p]) =>
      p["REGISTRY"] && p["REPOSITORY"] && p["TAG"] ? [prefix] : [],
    ),
  );
  const emitted = new Set<string>();
  return values.flatMap(({ index, name, value }): Reference[] => {
    const prefix = imagePart.exec(name)?.[1];
    if (prefix === undefined || !joined.has(prefix)) {
      return [{ index, ref: value }];
    }
    if (emitted.has(prefix)) {
      return [];
    }
    emitted.add(prefix);
    const p = parts.get(prefix)!;
    return [{ index, ref: `${p["REGISTRY"]}/${p["REPOSITORY"]}:${p["TAG"]}` }];
  });
}

function referencesIn(document: string): string[] {
  const direct = [imageField, imageArgument, embeddedImage].flatMap((pattern) =>
    [...document.matchAll(pattern)].map((match) => ({
      index: match.index,
      ref: match[1]!,
    })),
  );
  return [...direct, ...environmentReferences(document)]
    .sort((a, b) => a.index - b.index)
    .map(({ ref }) => ref)
    .filter((ref) => !ref.includes("{{"));
}

/** Distinct image references the manifests run, in order of appearance. */
export function renderedImages(manifests: string): string[] {
  const refs = manifests
    .split(/^---$/m)
    // `helm install` never creates test hooks, so their images never run.
    .filter((document) => !helmTestHook.test(document))
    .flatMap(referencesIn);
  return [...new Set(refs)];
}

/** Resolves Docker Hub shorthand so one image has one repository name. */
export function normalizeImage(ref: string): NormalizedImage {
  const [name = "", digest] = ref.split("@");
  const slash = name.indexOf("/");
  const first = slash === -1 ? "" : name.slice(0, slash);
  const hasHost = /[.:]/.test(first) || first === "localhost";
  const lastColon = name.lastIndexOf(":");
  const withoutTag =
    lastColon > name.lastIndexOf("/") ? name.slice(0, lastColon) : name;
  const qualified = hasHost ? withoutTag : `docker.io/${withoutTag}`;
  const host = qualified.split("/")[0];
  const path = qualified.slice((host ?? "").length + 1);
  const dockerHub = host === "docker.io" || host === "index.docker.io";
  const repository = dockerHub
    ? `docker.io/${path.includes("/") ? path : `library/${path}`}`
    : qualified;
  return { repository, ...(digest ? { digest } : {}) };
}

/**
 * The problems with rendered images: each must be pinned by digest and be an
 * approved repository at an approved digest. A chart bump that moves an image
 * to a new digest fails here until the approved list records it.
 */
export function unapprovedImages(
  rendered: string[],
  approved: string[],
): string[] {
  const allowed = new Set(
    approved.map((ref) => {
      const { repository, digest } = normalizeImage(ref);
      return `${repository}@${digest ?? ""}`;
    }),
  );
  return rendered.flatMap((ref) => {
    const { repository, digest } = normalizeImage(ref);
    if (!digest) {
      return [`${ref}: not pinned by digest`];
    }
    return allowed.has(`${repository}@${digest}`)
      ? []
      : [`${ref}: not in the approved image list`];
  });
}
