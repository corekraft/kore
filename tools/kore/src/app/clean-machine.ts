import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Runner } from "../runtime/index.js";

// Docs: infra/plans/2-implementation.md#step-13-complete-lifecycle-orchestration
export const cleanMachineProfile = "kore-clean-machine";

const environmentFile = "infra/environments/local/environment.yaml";

/**
 * The clean-machine test creates and deletes a Minikube profile, so the profile
 * must be its own. Anything else could be the developer's `kore-local`.
 */
export function assertThrowawayProfile(profile: string): void {
  if (!profile.startsWith("kore-clean-machine")) {
    throw new Error(
      `clean-machine profile "${profile}" is not a throwaway profile: it must start with kore-clean-machine, never the developer profile (kore-local)`,
    );
  }
}

/** The local environment with its cluster and context moved to `profile`. */
export function throwawayEnvironment(source: string, profile: string): string {
  assertThrowawayProfile(profile);
  const environment = JSON.parse(source) as {
    kubeContext: string;
    cluster: Record<string, unknown>;
  };
  environment.kubeContext = profile;
  environment.cluster = { ...environment.cluster, profile };
  return `${JSON.stringify(environment, null, 2)}\n`;
}

/**
 * Copies the tracked files of `source` to `destination` and points the local
 * environment at the throwaway profile. Running kore with KORE_ROOT set to the
 * copy keeps its journal, locks and `.kore/state` away from the real checkout,
 * and untracked files (including everything under `.kore/`) are never copied.
 */
export async function stageThrowawayCheckout(
  source: string,
  destination: string,
  profile: string,
  runner: Runner,
): Promise<void> {
  assertThrowawayProfile(profile);
  const { stdout } = await runner.run("git", ["-C", source, "ls-files", "-z"], {
    capture: true,
  });
  for (const file of stdout.split("\0").filter(Boolean)) {
    const target = join(destination, file);
    await mkdir(dirname(target), { recursive: true });
    if (file === environmentFile) {
      await writeFile(
        target,
        throwawayEnvironment(
          await readFile(join(source, file), "utf8"),
          profile,
        ),
      );
    } else {
      await copyFile(join(source, file), target);
    }
  }
}
