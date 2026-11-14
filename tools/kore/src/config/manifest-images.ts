/**
 * Finds the image and package references in plain manifests, which Helm does
 * not render: `image:` fields (a container image) and `package:` fields (a
 * Crossplane Function or Provider package, an OCI image). Both block and flow
 * mapping styles are read. Checked against the approved list with
 * `unapprovedImages` (ADR 0033).
 */
const reference = /\b(?:image|package):[ \t]*["']?([^"'\s,}#]+)/g;

/** Distinct references in the manifests, in order of appearance. */
export function manifestImages(manifests: string): string[] {
  const refs = [...manifests.matchAll(reference)]
    .map((match) => match[1]!)
    .filter((ref) => !ref.includes("{{"));
  return [...new Set(refs)];
}
