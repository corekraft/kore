import type { Repository } from "../config/index.js";
import type { LockedImage } from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import { converge, type AppUpOptions } from "./converge.js";

export type { AppUpOptions };
import { resolveImage } from "./image-source.js";

/**
 * Deploys the image release automation produced (ADR 0063): the entry for
 * `name` in the committed lock, or in `lockPath`, the lock attached to a release.
 */
export async function appUpRelease(
  repository: Repository,
  runner: Runner,
  name: string,
  lockPath?: string,
  options: AppUpOptions = {},
): Promise<void> {
  await converge(
    repository,
    runner,
    name,
    await resolveImage(
      repository,
      name,
      undefined,
      options.publicKey,
      lockPath,
    ),
    options,
  );
}

/**
 * `imageOverride` is the source build `kore local up` hands over; without it
 * this is `appUpRelease` on the committed lock.
 */
export async function appUp(
  repository: Repository,
  runner: Runner,
  name: string,
  imageOverride?: LockedImage,
  options: AppUpOptions = {},
): Promise<void> {
  await converge(
    repository,
    runner,
    name,
    await resolveImage(repository, name, imageOverride, options.publicKey),
    options,
  );
}
