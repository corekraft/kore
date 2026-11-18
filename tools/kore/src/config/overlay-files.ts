import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exists } from "./files.js";
import { registryConsumers } from "./registry-address.js";
import type { Environment } from "./types.js";

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
