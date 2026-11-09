import type { Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";

function isResourceTypeMissing(error: unknown): boolean {
  return /the server doesn't have a resource type/i.test(errorText(error));
}

function errorText(error: unknown): string {
  if (error instanceof CommandError) {
    return error.result.stderr;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** The StorageClass whose volumes outlive their claims (`reclaimPolicy: Retain`). */
const RETAINED_STORAGE_CLASS = "kore-retained";

interface VolumeList {
  items?: {
    metadata?: { name?: string };
    spec?: {
      storageClassName?: string;
      claimRef?: { namespace?: string };
    };
  }[];
}

/**
 * Volumes of the retained storage class. Deleting a retained claim leaves its
 * PersistentVolume behind as Released, with no label and no claim to find it
 * by, so volumes are discovered by class (scoped by the namespace of the claim
 * that last bound them). An unreadable list refuses rather than reporting none.
 */
async function retainedVolumes(
  repository: Repository,
  runner: Runner,
  namespace?: string,
): Promise<string[]> {
  const result = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "get",
      "persistentvolumes",
      "-o",
      "json",
    ],
    { capture: true },
  );
  let list: VolumeList;
  try {
    list = JSON.parse(result.stdout || "{}") as VolumeList;
  } catch (error) {
    throw new Error(
      `could not read the PersistentVolume list: ${errorText(error)}. Check the cluster with kubectl before destroying anything.`,
    );
  }
  return (list.items ?? [])
    .filter(
      (volume) =>
        volume.spec?.storageClassName === RETAINED_STORAGE_CLASS &&
        (!namespace || volume.spec.claimRef?.namespace === namespace),
    )
    .map((volume) => `persistentvolume/${volume.metadata?.name ?? ""}`);
}

export async function retainedResources(
  repository: Repository,
  runner: Runner,
  namespace?: string,
): Promise<string[]> {
  const context = repository.environment.kubeContext;
  const scope = namespace ? `--namespace=${namespace}` : "--all-namespaces";
  const queries = [
    [
      "--context",
      context,
      "get",
      "postgresqlinstances.platform.kore.dev",
      scope,
      "-l",
      "platform.kore.dev/retention=Retain",
      "-o",
      "name",
    ],
    [
      "--context",
      context,
      "get",
      "pvc",
      scope,
      "-l",
      "platform.kore.dev/retention=Retain",
      "-o",
      "name",
    ],
  ];
  const retained: string[] = [];
  for (const args of queries) {
    try {
      const result = await runner.run("kubectl", args, { capture: true });
      retained.push(
        ...result.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );
    } catch (error) {
      // An API that is not installed cannot contain retained data; any other
      // failure (unreachable cluster, wrong context) must refuse the destroy.
      if (!isResourceTypeMissing(error)) {
        throw error;
      }
    }
  }
  retained.push(...(await retainedVolumes(repository, runner, namespace)));
  return [...new Set(retained)].sort();
}

export async function purgeRetainedResources(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const context = repository.environment.kubeContext;
  const selector = "platform.kore.dev/retention=Retain";
  // A claim still mounted by a running pod stays Terminating until the pod
  // goes, so waiting on it would hang; the profile deletion that follows
  // removes the pod and the volume.
  const targets = [
    { resource: "postgresqlinstances.platform.kore.dev", wait: "--wait" },
    { resource: "pvc", wait: "--wait=false" },
  ];
  for (const { resource, wait } of targets) {
    try {
      await runner.run(
        "kubectl",
        [
          "--context",
          context,
          "delete",
          resource,
          "--all-namespaces",
          "--selector",
          selector,
          "--ignore-not-found",
          wait,
        ],
        { capture: true },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (
        !/doesn't have a resource type|the server doesn't have a resource type|no matches for kind/i.test(
          detail,
        )
      ) {
        throw error;
      }
    }
  }
}
