import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

const ROLE = "system:metrics-server";

/**
 * Fails fast when the metrics-server ClusterRole belongs to k3s's bundled
 * add-on, which a cluster created before Kore disabled it still runs. Helm
 * cannot adopt a resource another owner manages, and Kore never deletes the
 * add-on's resources by hand, so the fix is to recreate the cluster (data is
 * kept without `--purge-data`). Read-only. A missing ClusterRole or one the
 * release already owns passes.
 */
export async function assertMetricsServerUnowned(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const { kubeContext } = repository.environment;
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      kubeContext,
      "get",
      "clusterrole",
      ROLE,
      "--ignore-not-found",
      "--output",
      'jsonpath={.metadata.name}{"|"}{.metadata.annotations.meta\\.helm\\.sh/release-name}',
    ],
    { capture: true },
  );
  const found = stdout.trim();
  if (found === "" || found === `${ROLE}|metrics-server`) {
    return;
  }
  throw new Error(
    `ClusterRole ${ROLE} in ${kubeContext} is owned by the k3s bundled metrics-server add-on, so the metrics-server release cannot adopt it (one owner per resource); recreate the cluster with \`kore local down --prune\` then \`kore local up\` (retained data is kept)`,
  );
}
