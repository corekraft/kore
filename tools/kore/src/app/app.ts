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

export async function appDown(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<string[]> {
  await assertExpectedCluster(repository, runner);
  await runner.run(
    "helm",
    [
      "uninstall",
      name,
      `--namespace=${name}`,
      "--kube-context",
      repository.environment.kubeContext,
      "--wait",
      "--timeout=10m",
    ],
    { capture: false },
  );
  // Only the workload release is removed; the resources release keeps the
  // claim and its data. Report what stays so the operator knows it remains.
  return await retainedResources(repository, runner, name);
}
