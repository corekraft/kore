import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "../config/index.js";
import { assertExpectedCluster, retainedResources } from "../cluster/index.js";
import { imageForApplication, loadImageLock } from "../images/index.js";
import type { Runner } from "../runtime/index.js";

export async function appStatus(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<Record<string, unknown>> {
  await assertExpectedCluster(repository, runner);
  const localImageLockPath = ".kore/state/local-images.lock.json";
  let imageLockPath: string | undefined;
  if (repository.environment.provider === "minikube") {
    try {
      await access(join(repository.root, localImageLockPath));
      imageLockPath = localImageLockPath;
    } catch {
      /* No local source build has been recorded yet; use the release lock. */
    }
  }
  const imageLock = await loadImageLock(repository.root, imageLockPath);
  const image = imageForApplication(imageLock, name);
  const resources = await runner.run(
    "helm",
    [
      "status",
      `${name}-resources`,
      `--namespace=${name}`,
      "--kube-context",
      repository.environment.kubeContext,
      "--output",
      "json",
    ],
    { capture: true },
  );
  const workload = await runner.run(
    "helm",
    [
      "status",
      name,
      `--namespace=${name}`,
      "--kube-context",
      repository.environment.kubeContext,
      "--output",
      "json",
    ],
    { capture: true },
  );
  return {
    name,
    image,
    resources: JSON.parse(resources.stdout),
    workload: JSON.parse(workload.stdout),
  };
}

export interface AppDownReport {
  retained: string[];
  warnings: string[];
}

export async function appDown(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<AppDownReport> {
  await assertExpectedCluster(repository, runner);
  // --ignore-not-found makes a rerun after a partial failure succeed.
  await runner.run(
    "helm",
    [
      "uninstall",
      name,
      `--namespace=${name}`,
      "--kube-context",
      repository.environment.kubeContext,
      "--ignore-not-found",
      "--wait",
      "--timeout=10m",
    ],
    { capture: false },
  );
  // Only the workload release is removed; the resources release keeps the
  // claim and its data. Report what stays so the operator knows it remains.
  // The uninstall already succeeded, so a failed read is a warning, not a
  // failure that would make a rerun look like the uninstall went wrong.
  try {
    return {
      retained: await retainedResources(repository, runner, name),
      warnings: [],
    };
  } catch (error) {
    return {
      retained: [],
      warnings: [
        `could not list retained data in namespace ${name}: ${error instanceof Error ? error.message : String(error)}. The workload was uninstalled; check retained claims with kubectl before destroying anything.`,
      ],
    };
  }
}
