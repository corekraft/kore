import { access } from "node:fs/promises";
import { join, relative } from "node:path";
import { environmentStatePath } from "../runtime/environment-state.js";
import { isLocalProvider, type Repository } from "../config/index.js";
import {
  assertReleaseAutomationImage,
  imageForApplication,
  loadImageLock,
  type LockedImage,
} from "../images/index.js";

/** The local developer key signs source builds that only `kore local up` hands over. */
export const localSigner = "local-kore-key";

function assertLocalBuild(
  repository: Repository,
  image: LockedImage,
  publicKey: string | undefined,
): void {
  if (
    image.signer !== localSigner ||
    !isLocalProvider(repository.environment) ||
    !publicKey
  ) {
    throw new Error(
      `a source-built image is accepted only on a local k3d environment, signed by ${localSigner}, from kore local up; got signer ${image.signer} on provider ${repository.environment.provider}. Deploy release images with kore app up --image-lock <release lock>`,
    );
  }
}

/**
 * Resolves the image to deploy before the cluster is touched. Without an
 * override it is the lock entry release automation produced; the override is
 * the local source build from `kore local up` (ADR 0015, 0063).
 */
export async function resolveImage(
  repository: Repository,
  name: string,
  imageOverride: LockedImage | undefined,
  publicKeyOverride: string | undefined,
  lockPath?: string,
): Promise<LockedImage> {
  if (imageOverride) {
    assertLocalBuild(repository, imageOverride, publicKeyOverride);
    return imageOverride;
  }
  const image = imageForApplication(
    await loadImageLock(repository.root, lockPath),
    name,
  );
  assertReleaseAutomationImage(name, image);
  return image;
}

const localLockPath = (repository: Repository) =>
  relative(
    repository.root,
    environmentStatePath(
      repository.root,
      repository.environment.name,
      "local-images.lock.json",
    ),
  );

/**
 * The image `app status` compares against: on a local cluster the lock of the last
 * source build when one exists, otherwise the release lock.
 */
export async function lockedImageForStatus(
  repository: Repository,
  name: string,
): Promise<LockedImage> {
  let path: string | undefined;
  if (isLocalProvider(repository.environment)) {
    try {
      const candidate = localLockPath(repository);
      await access(join(repository.root, candidate));
      path = candidate;
    } catch {
      /* No local source build has been recorded yet; use the release lock. */
    }
  }
  return imageForApplication(await loadImageLock(repository.root, path), name);
}
