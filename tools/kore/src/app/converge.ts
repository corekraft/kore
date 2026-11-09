import type { Repository } from "../config/index.js";
import type { LockedImage } from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import {
  activateNamespace,
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
  waitForRollouts,
} from "./readiness.js";
import { verifyImage } from "./verify.js";

export async function converge(
  repository: Repository,
  runner: Runner,
  name: string,
  image: LockedImage,
  publicKeyOverride: string | undefined,
): Promise<void> {
  // Applications are admitted only through an open gate for this generation.
  const generation = await assertAppAdmissible(repository, runner);
  await verifyImage(repository, runner, image, publicKeyOverride);
  const workloadImage = await stageLocalImage(repository, runner, image);
  const charts = await resolveCharts(repository, name);
  await enrollNamespace(repository, runner, name);
  await activateNamespace(repository, runner, name, generation);
  await cleanupInterruptedReleases(repository, runner, name);
  await installResources(repository, runner, name, charts);
  await waitForResources(repository, runner, name);
  await installWorkload(repository, runner, name, charts, workloadImage);
  await waitForRollouts(repository, runner, name);
}
