import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { k3dTrustDirectory } from "../images/index.js";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  assertExpectedK3dCluster,
  contextRemedy,
  k3dCluster,
  k3dContext,
  listOrUnavailable,
  runK3d,
} from "./k3d-cluster.js";

/** Stops the cluster, keeping data; a stopped or absent cluster is a no-op. */
export async function clusterStopK3d(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const { clusterName } = k3dCluster(repository.environment);
  const { state } = await listOrUnavailable(repository.environment, runner);
  if (state !== "running") {
    return;
  }
  await assertExpectedK3dCluster(repository, runner);
  await runK3d(runner, ["cluster", "stop", clusterName], { capture: false });
}

/** Destroy's read-only pre-check: a wrong context pair throws; absent means no-op. */
export async function k3dDestroyIsNoop(
  repository: Repository,
  runner: Runner,
): Promise<boolean> {
  const { environment } = repository;
  const { clusterName } = k3dCluster(environment);
  if (k3dContext(clusterName) !== environment.kubeContext) {
    throw new Error(
      `refusing unexpected cluster/context pair: ${k3dContext(clusterName)} != ${environment.kubeContext}; ${contextRemedy(clusterName)}`,
    );
  }
  return (await listOrUnavailable(environment, runner)).state === "absent";
}

/**
 * Deletes the cluster and its host registry-trust directory
 * (`~/.kore/k3d/<cluster>`, public material only); callers apply the consent
 * and data gates first.
 */
export async function deleteK3dCluster(
  repository: Repository,
  runner: Runner,
  home: string = homedir(),
): Promise<void> {
  const { clusterName } = k3dCluster(repository.environment);
  await runK3d(runner, ["cluster", "delete", clusterName], { capture: false });
  await rm(dirname(k3dTrustDirectory(clusterName, home)), {
    recursive: true,
    force: true,
  });
}
