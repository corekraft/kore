import type { Repository } from "../config/index.js";
import { orderedComponents } from "../config/index.js";
import {
  assertExpectedCluster,
  ClusterUnavailableError,
  clusterUp,
} from "../cluster/index.js";
import type { Runner } from "../runtime/index.js";
import { reconcileIfNeeded } from "./reconcile.js";

async function ensureCluster(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  if (repository.environment.provider !== "minikube") {
    await assertExpectedCluster(repository, runner);
    return;
  }
  try {
    await assertExpectedCluster(repository, runner);
  } catch (error) {
    if (!(error instanceof ClusterUnavailableError)) {
      throw error;
    }
    await clusterUp(repository, runner);
  }
}

export async function bootstrapControllers(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  await ensureCluster(repository, runner);
  for (const component of orderedComponents(repository.catalog)) {
    if (
      component.phase === "configuration" ||
      component.phase === "enforcement"
    ) {
      continue;
    }
    await reconcileIfNeeded(repository, runner, component);
  }
}
