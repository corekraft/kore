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
  /name:\s*["']?\w*IMAGE\w*["']?\s+value:\s*["']?([^"'\s]+)/g;
const embeddedImage = /"image":\s*"([^"\s]+)"/g;
const helmTestHook = /helm\.sh\/hook"?:\s*"?[^\n]*\btest\b/;

function referencesIn(document: string): string[] {
  return [imageField, imageArgument, imageEnvironment, embeddedImage]
    .flatMap((pattern) => [...document.matchAll(pattern)])
    .sort((a, b) => a.index - b.index)
    .map((match) => match[1]!)
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
