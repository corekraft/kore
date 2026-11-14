import type { Repository } from "../config/index.js";
import { retainedResources } from "../cluster/index.js";
import { recoverRelease } from "../platform/index.js";
import type { Runner } from "../runtime/index.js";

/**
 * Before another `app up`, clears what a failed or canceled attempt left: a
 * release that never deployed is uninstalled and verified gone, a canceled
 * upgrade returns to its last deployed revision. Only this application's two
 * releases are examined; a healthy release is never touched. The Helm release
 * is what the attempt owns, with every object it rendered. The namespace, the
 * registry pull Secret and the claims of a deployed resources release are not
 * attempt-owned: they are applied idempotently or hold data.
 *
 * A never-deployed resources release is refused rather than uninstalled while
 * retained data exists in the namespace, because uninstalling it would delete
 * that data's claim (ADR 0063).
 */
export async function cleanupInterruptedReleases(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<void> {
  const timeout = "10m";
  await recoverRelease(
    repository,
    runner,
    { name: `${name}-resources`, namespace: name, timeout },
    async () => {
      const retained = await retainedResources(repository, runner, name);
      if (retained.length) {
        throw new Error(
          `release ${name}-resources never deployed, but retained data exists in namespace ${name} (${retained.join(", ")}) and uninstalling the release would delete its claim. Keep the data: run kore data export --environment ${repository.environment.name}, then remove the failed release by hand once the export is verified, or run kore app up again after fixing the cause`,
        );
      }
    },
  );
  await recoverRelease(repository, runner, { name, namespace: name, timeout });
}
