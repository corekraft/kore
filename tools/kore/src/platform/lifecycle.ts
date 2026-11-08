import type { Repository } from "../config/index.js";
import { clusterDestroy, clusterStop } from "../cluster/index.js";
import type { Runner } from "../runtime/index.js";
import { stopLocalTunnel } from "../tunnel/index.js";

export async function platformStop(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  if (repository.environment.provider === "minikube") {
    await stopLocalTunnel(repository, runner);
  }
  await clusterStop(repository, runner);
}

export async function platformDestroy(
  repository: Repository,
  runner: Runner,
  options: { yes: boolean; purgeData: boolean },
): Promise<void> {
  if (repository.environment.provider === "minikube") {
    await stopLocalTunnel(repository, runner);
  }
  await clusterDestroy(repository, runner, options);
}
