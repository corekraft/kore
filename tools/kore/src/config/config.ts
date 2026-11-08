import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { exists } from "./files.js";
import { validateRepository } from "./validate.js";
import type {
  Catalog,
  Component,
  Environment,
  Repository,
  Versions,
} from "./types.js";

export type {
  Catalog,
  Component,
  ComponentKind,
  Environment,
  Phase,
  Repository,
  Versions,
} from "./types.js";
export { orderedComponents } from "./order.js";
export { validateRepository } from "./validate.js";

export async function findRoot(start = process.cwd()): Promise<string> {
  if (process.env.KORE_ROOT) {
    return resolve(process.env.KORE_ROOT);
  }
  let candidate = resolve(start);
  while (true) {
    if (await exists(join(candidate, "infra/catalog/components.yaml"))) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error(
        "not inside a Kore repository (set KORE_ROOT to override)",
      );
    }
    candidate = parent;
  }
}

async function loadJSON<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    throw new Error(
      `validate ${path}: files must use JSON-compatible YAML: ${String(error)}`,
    );
  }
}

export async function loadRepository(
  environmentName = "local",
  start?: string,
): Promise<Repository> {
  const root = await findRoot(start);
  const [versions, catalog, environment] = await Promise.all([
    loadJSON<Versions>(join(root, "infra/catalog/versions.yaml")),
    loadJSON<Catalog>(join(root, "infra/catalog/components.yaml")),
    loadJSON<Environment>(
      join(root, "infra/environments", environmentName, "environment.yaml"),
    ),
  ]);
  const repository = { root, versions, catalog, environment };
  await validateRepository(repository);
  return repository;
}

export function componentVersion(
  repository: Repository,
  component: Component,
): string | undefined {
  if (component.version === "local") {
    return undefined;
  }
  return repository.versions.components[component.version]?.replace(/^v/, "");
}

export function expandVersions(repository: Repository, value: string): string {
  return Object.entries(repository.versions.components).reduce(
    (result, [key, version]) =>
      result.replaceAll(`\${${key}}`, version.replace(/^v/, "")),
    value,
  );
}

export function absolute(repository: Repository, path: string): string {
  return isAbsolute(path) ? path : join(repository.root, path);
}

export function componentValues(
  repository: Repository,
  component: Component,
): string[] {
  return [
    ...(component.values ?? []),
    ...(repository.environment.componentValues?.[component.name] ?? []),
  ];
}
