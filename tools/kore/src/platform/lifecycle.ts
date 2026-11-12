import type { Repository } from "../config/index.js";
import { clusterDestroy, clusterStop } from "../cluster/index.js";
import type { ProcessControl, Runner } from "../runtime/index.js";
import { stopRegistryForward } from "../images/index.js";
import { stopLocalTunnel } from "../tunnel/index.js";

export async function platformStop(
  repository: Repository,
  runner: Runner,
  processes: ProcessControl = {},
): Promise<void> {
  if (repository.environment.provider === "minikube") {
    await stopLocalTunnel(repository, runner, processes);
  }
  if (repository.environment.provider !== "managed") {
    await stopRegistryForward(repository, processes);
  }
  await clusterStop(repository, runner);
}

export async function platformDestroy(
  repository: Repository,
  runner: Runner,
  options: { yes: boolean; purgeData: boolean },
  processes: ProcessControl = {},
): Promise<void> {
  if (repository.environment.provider === "minikube") {
    await stopLocalTunnel(repository, runner, processes);
  }
  if (repository.environment.provider !== "managed") {
    await stopRegistryForward(repository, processes);
  }
  await clusterDestroy(repository, runner, options);
}
