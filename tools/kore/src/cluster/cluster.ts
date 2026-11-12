import type { Repository } from "../config/index.js";
import { managedCluster } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import type { ReadinessOptions } from "./readiness.js";
import { hasVerifiedExport } from "./export-manifest.js";
import {
  assertExpectedK3dCluster,
  clusterStatusK3d,
  clusterUpK3d,
} from "./k3d-cluster.js";
import {
  clusterStopK3d,
  deleteK3dCluster,
  k3dDestroyIsNoop,
} from "./k3d-lifecycle.js";
import { purgeRetainedResources, retainedResources } from "./retained.js";

import { ClusterUnavailableError } from "./cluster-unavailable.js";

export { ClusterUnavailableError };

export async function assertExpectedCluster(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const { environment } = repository;
  if (environment.provider === "k3d") {
    return await assertExpectedK3dCluster(repository, runner);
  }
  await runner.run(
    "kubectl",
    [
      "--context",
      environment.kubeContext,
      "get",
      "namespace",
      "kube-system",
      "-o",
      "name",
    ],
    { capture: true },
  );
}

export async function clusterUp(
  repository: Repository,
  runner: Runner,
  readiness: ReadinessOptions = {},
  home?: string,
): Promise<void> {
  const { environment } = repository;
  if (environment.provider === "k3d") {
    return await clusterUpK3d(repository, runner, readiness, home);
  }
  throw new Error(
    "cluster up only manages k3d environments; provision managed clusters with OpenTofu",
  );
}

export async function clusterStatus(
  repository: Repository,
  runner: Runner,
): Promise<Record<string, unknown>> {
  const { environment } = repository;
  if (environment.provider === "k3d") {
    return await clusterStatusK3d(repository, runner);
  }
  const result = await runner.run(
    "kubectl",
    ["--context", environment.kubeContext, "cluster-info"],
    { capture: true },
  );
  return {
    environment: environment.name,
    profile: managedCluster(environment).profile,
    context: environment.kubeContext,
    status: result.stdout.trim(),
  };
}

export async function clusterStop(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  if (repository.environment.provider === "k3d") {
    return await clusterStopK3d(repository, runner);
  }
  throw new Error("cluster stop is only available for k3d environments");
}

export async function clusterDestroy(
  repository: Repository,
  runner: Runner,
  options: { yes: boolean; purgeData: boolean },
  home?: string,
): Promise<void> {
  const { provider } = repository.environment;
  if (provider !== "k3d") {
    throw new Error("cluster destroy is only available for k3d environments");
  }
  if (await k3dDestroyIsNoop(repository, runner)) {
    return;
  }
  let clusterVerified = true;
  try {
    await assertExpectedCluster(repository, runner);
  } catch (error) {
    clusterVerified = false;
    if (!options.purgeData && !(await hasVerifiedExport(repository))) {
      throw new Error(
        `destroy blocked because retained data cannot be verified on the stopped/unreachable profile: ${error instanceof Error ? error.message : String(error)}; export data or use --purge-data`,
      );
    }
  }
  const retained = clusterVerified
    ? await retainedResources(repository, runner)
    : [];
  if (retained.length && !options.purgeData) {
    throw new Error(
      `destroy blocked by retained data:\n${retained.join("\n")}\nExport it or repeat with --purge-data`,
    );
  }
  if (!options.yes) {
    throw new Error(
      "destruction requires --yes (and --purge-data when retained data exists)",
    );
  }
  if (options.purgeData && clusterVerified) {
    await purgeRetainedResources(repository, runner);
  }
  return await deleteK3dCluster(repository, runner, home);
}
