import {
  featureEnabled,
  registryPruneFlag,
  type Repository,
} from "../config/index.js";
import { holdsHostLease, type Runner } from "../runtime/index.js";
import { imagesInUse } from "./image-prune.js";
import { lockedDigests } from "./lock-digests.js";
import { withPublishSession } from "./local-publish.js";
import { createRegistryAdmin } from "./registry-admin.js";
import { pruneRegistryTags } from "./registry-prune.js";
import { ensureRegistryForward } from "./registry-service.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

const keepWindowMs = 7 * 24 * 60 * 60 * 1000;

/**
 * Prunes the cluster's registry for `kore local up`: a no-op unless the
 * `registry-tag-pruning` flag is on. The push identity deletes, through the
 * port-forward; garbage collection runs in the registry container.
 */
export async function pruneRegistryTagsInCluster(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  if (!featureEnabled(repository.environment, registryPruneFlag)) {
    return;
  }
  await withPublishSession(repository, runner, async ({ ca, client }) => {
    await ensureRegistryForward(repository, runner);
    await pruneRegistryTags(repository, {
      holdsLease: holdsHostLease,
      podImages: async () => await imagesInUse(repository, runner),
      lockedDigests: async () => await lockedDigests(repository),
      admin: createRegistryAdmin({
        address: client.address,
        authorization: client.authorization,
        ca,
      }),
      collectGarbage: async () => {
        await runner.run(
          "kubectl",
          [
            "--context",
            repository.environment.kubeContext,
            "--namespace",
            "kore-registry",
            "exec",
            "deployment/oci-registry",
            "--container",
            "registry",
            "--",
            "registry",
            "garbage-collect",
            "/etc/distribution/config.yml",
          ],
          { capture: true },
        );
      },
      now: Date.now,
      keepWindowMs,
    });
  });
}
