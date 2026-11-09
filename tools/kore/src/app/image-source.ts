import type { Repository } from "../config/index.js";
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
    repository.environment.provider !== "minikube" ||
    !publicKey
  ) {
    throw new Error(
      `a source-built image is accepted only on Minikube, signed by ${localSigner}, from kore local up; got signer ${image.signer} on provider ${repository.environment.provider}. Deploy release images with kore app up --image-lock <release lock>`,
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
