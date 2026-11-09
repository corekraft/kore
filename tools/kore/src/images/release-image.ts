import type { LockedImage } from "./image-lock.js";

/**
 * The identity of protected release automation (ADR 0005): the release
 * workflow at an exact version tag. Branch, pull-request and local identities
 * never match. The release workflow's own lock check uses the same shape.
 */
export const releaseSignerPattern =
  /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/\.github\/workflows\/[^@\s/]+@refs\/tags\/v\d+\.\d+\.\d+$/;

export function isReleaseAutomationSigner(signer: string): boolean {
  return releaseSignerPattern.test(signer);
}

/**
 * `kore app up` deploys only what release automation produced. A lock entry
 * signed by any other identity, the local developer key included, is refused
 * before any signature check or Helm call (ADR 0063).
 */
export function assertReleaseAutomationImage(
  application: string,
  image: LockedImage,
): void {
  if (!isReleaseAutomationSigner(image.signer)) {
    throw new Error(
      `the image lock entry for ${application} is signed by ${image.signer}, which is not release automation (a workflow at a version tag). kore app up deploys only release-produced images: pass the lock attached to a release with --image-lock <file>. To run a source build locally use kore local up --environment local`,
    );
  }
}
