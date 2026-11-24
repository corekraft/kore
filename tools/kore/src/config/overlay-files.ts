import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exists } from "./files.js";
import { flagManifestPath } from "./flag-manifest.js";
import { k3sHostEnvironment, k3sPinFile } from "./k3s-pin.js";
import { suborgNames } from "./organization-records.js";
import { registryConsumers } from "./registry-address.js";
import type { Environment, FlagManifest } from "./types.js";

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

const k3sVersionLine = /^k3s_version:\s*(\S+)\s*$/m;

// The k3s role's defaults are Ansible YAML, not JSON, so the one pin line is
// read by pattern. Only the host environment's validation reads it.
export async function loadK3sHostPin(
  root: string,
  environmentName: string,
): Promise<string | undefined> {
  if (environmentName !== k3sHostEnvironment) {
    return undefined;
  }
  const match = k3sVersionLine.exec(
    await readFile(join(root, k3sPinFile), "utf8"),
  );
  if (!match?.[1]) {
    throw new Error(
      `${k3sPinFile} must set k3s_version to the pinned k3s release, for example v1.37.2+k3s1`,
    );
  }
  return match[1];
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
