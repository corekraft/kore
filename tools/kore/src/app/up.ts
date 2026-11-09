import type { Repository } from "../config/index.js";
import { assertExpectedCluster } from "../cluster/index.js";
import {
  imageForApplication,
  loadImageLock,
  type LockedImage,
} from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import {
  activateNamespace,
  enrollNamespace,
  installResources,
  installWorkload,
  resolveCharts,
} from "./install.js";
import { stageLocalImage } from "./local-image.js";
import {
  assertApplicationAdmission,
  assertPlatformReady,
  waitForResources,
  waitForRollouts,
} from "./readiness.js";
import { verifyImage } from "./verify.js";

export interface AppUpOptions {
  /** Verify against this public key instead of the image's signer key. */
  publicKey?: string;
  /** Restores the local endpoint once the platform is proven ready (ADR 0060). */
  ensureTunnel?: () => Promise<unknown>;
}

export async function appUp(
  repository: Repository,
  runner: Runner,
  name: string,
  imageOverride?: LockedImage,
  options: AppUpOptions = {},
): Promise<void> {
  await assertExpectedCluster(repository, runner);
  await assertPlatformReady(repository, runner);
  // Applications are admitted only through an open gate for this generation.
  const generation = await assertApplicationAdmission(repository, runner);
  await options.ensureTunnel?.();
  const image =
    imageOverride ??
    imageForApplication(await loadImageLock(repository.root), name);
  await verifyImage(repository, runner, image, options.publicKey);
  const workloadImage = await stageLocalImage(repository, runner, image);
  const charts = await resolveCharts(repository, name);
  await enrollNamespace(repository, runner, name);
  await activateNamespace(repository, runner, name, generation);
  await installResources(repository, runner, name, charts);
  await waitForResources(repository, runner, name);
  await installWorkload(repository, runner, name, charts, workloadImage);
  await waitForRollouts(repository, runner, name);
}
