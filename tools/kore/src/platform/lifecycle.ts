import type { Repository } from "../config/index.js";
import { clusterDestroy, clusterStop } from "../cluster/index.js";
import type { ProcessControl, Runner } from "../runtime/index.js";
import { stopRegistryForward } from "../images/index.js";

export async function platformStop(
  repository: Repository,
  runner: Runner,
  processes: ProcessControl = {},
  options: { force?: boolean } = {},
): Promise<void> {
  if (repository.environment.provider !== "managed") {
    await stopRegistryForward(repository, processes, options);
  }
  await clusterStop(repository, runner);
}

export async function platformDestroy(
  repository: Repository,
  runner: Runner,
  options: { yes: boolean; purgeData: boolean; force?: boolean },
  processes: ProcessControl = {},
): Promise<void> {
  if (repository.environment.provider !== "managed") {
    await stopRegistryForward(repository, processes, options);
  }
  await clusterDestroy(repository, runner, options);
}
