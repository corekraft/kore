import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A second Minikube profile and environment for the live upgrade test, so it
 * never touches `kore-local` or its retained data. The Gateway port differs
 * because the tunnel holds a host port; everything else is the tree's own
 * `local` environment.
 */
export const THROWAWAY = {
  name: "upgrade-test",
  profile: "kore-upgrade-test",
  gatewayPort: 18443,
} as const;

export function throwawayEnvironment(
  local: Record<string, unknown>,
): Record<string, unknown> {
  const copy = structuredClone(local) as Record<string, unknown> & {
    cluster?: Record<string, unknown>;
    gateway?: Record<string, unknown>;
  };
  return {
    ...copy,
    name: THROWAWAY.name,
    kubeContext: THROWAWAY.profile,
    cluster: { ...copy.cluster, profile: THROWAWAY.profile },
    gateway: { ...copy.gateway, port: THROWAWAY.gatewayPort },
  };
}

/**
 * Writes the throwaway environment into `root` (derived from that tree's own
 * `local` environment, so an old release's schema is respected) and returns a
 * function that removes it. Refuses to overwrite an existing directory.
 */
export async function installThrowawayEnvironment(
  root: string,
): Promise<() => Promise<void>> {
  const directory = join(root, "infra/environments", THROWAWAY.name);
  const local = JSON.parse(
    await readFile(
      join(root, "infra/environments/local/environment.yaml"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  try {
    await mkdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `${directory} already exists; remove the leftover throwaway environment first`,
      );
    }
    throw error;
  }
  await writeFile(
    join(directory, "environment.yaml"),
    `${JSON.stringify(throwawayEnvironment(local), null, 2)}\n`,
  );
  return () => rm(directory, { recursive: true, force: true });
}
