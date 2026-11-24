import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exists } from "./files.js";
import { flagManifestPath } from "./flag-manifest.js";
import { suborgNames } from "./organization-records.js";
import { registryConsumers } from "./registry-address.js";
import type { Environment, FlagManifest } from "./types.js";

/** The age recipients `.sops.yaml` names for an environment, read by the loader (ADR 0155). */
export { loadSopsRecipients } from "./sops-recipients.js";

/**
 * The suborg names of an environment's Organization records, in name order: the
 * records that pass the checks (ADR 0161). The catalog's namespaces are what the
 * reserved names are built from.
 */
export async function loadSuborgNames(
  root: string,
  environment: Environment,
  catalogNamespaces: readonly string[],
): Promise<string[]> {
  return suborgNames({ root, environment, catalogNamespaces });
}

/** The flag manifest of the repository root, JSON-compatible YAML (ADR 0148). */
export async function loadFlagManifest(root: string): Promise<FlagManifest> {
  return loadJSON<FlagManifest>(join(root, flagManifestPath));
}

export async function loadJSON<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    throw new Error(
      `validate ${path}: files must use JSON-compatible YAML: ${String(error)}`,
    );
  }
}

// The environment overlay of the image policy owns the trust authority. A
// missing file is reported by validation, not here.
export async function loadImageTrustValues(
  root: string,
  environment: Environment,
): Promise<Record<string, unknown> | undefined> {
  const path = environment.componentValues?.["kore-image-policy"]?.[0];
  if (!path || !(await exists(join(root, path)))) {
    return undefined;
  }
  return loadJSON<Record<string, unknown>>(join(root, path));
}

export async function loadRegistryComponentValues(
  root: string,
  environment: Environment,
): Promise<Record<string, Record<string, unknown>>> {
  const loaded: Record<string, Record<string, unknown>> = {};
  for (const component of registryConsumers) {
    for (const path of environment.componentValues?.[component] ?? []) {
      if (await exists(join(root, path))) {
        loaded[component] = {
          ...loaded[component],
          ...(await loadJSON<Record<string, unknown>>(join(root, path))),
        };
      }
    }
  }
  return loaded;
}
