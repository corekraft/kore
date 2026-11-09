import type { Repository } from "../config/index.js";
import type { LockedImage } from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import {
  activateNamespace,
  bindCrossplaneSecrets,
  enrollNamespace,
  installResources,
  installWorkload,
  resolveCharts,
} from "./install.js";
import { cleanupInterruptedReleases } from "./cleanup.js";
import { stageLocalImage } from "./local-image.js";
import {
  assertAppAdmissible,
  waitForResources,
  waitForRoutes,
  waitForRollouts,
} from "./readiness.js";
import { verifyImage } from "./verify.js";

export interface AppUpOptions {
  /** Verify against this public key instead of the image's signer key. */
  publicKey?: string;
  /** Restores the local endpoint once the platform is proven ready (ADR 0060). */
  ensureTunnel?: () => Promise<unknown>;
  /** Bound for each HTTPRoute wait; defaults to five minutes. */
  routeTimeout?: string;
}

export async function converge(
  repository: Repository,
  runner: Runner,
  name: string,
  image: LockedImage,
  options: AppUpOptions,
): Promise<void> {
  // Applications are admitted only through an open gate for this generation.
  const generation = await assertAppAdmissible(repository, runner);
  await options.ensureTunnel?.();
  await verifyImage(repository, runner, image, options.publicKey);
  const workloadImage = await stageLocalImage(repository, runner, image);
  const charts = await resolveCharts(repository, name);
  await enrollNamespace(repository, runner, name);
  await activateNamespace(repository, runner, name, generation);
  await bindCrossplaneSecrets(repository, runner, name);
  await cleanupInterruptedReleases(repository, runner, name);
  await installResources(repository, runner, name, charts);
  await waitForResources(repository, runner, name);
  await installWorkload(repository, runner, name, charts, workloadImage);
  await waitForRollouts(repository, runner, name);
  await waitForRoutes(repository, runner, name, options.routeTimeout);
}
