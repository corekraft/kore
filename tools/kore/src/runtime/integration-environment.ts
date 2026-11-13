import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Docs: AGENTS.md "Mutations are serialized per environment."

/** The repository root, found the way `findRoot` finds it, without awaiting. */
function repositoryRoot(start: string): string {
  if (process.env.KORE_ROOT) {
    return resolve(process.env.KORE_ROOT);
  }
  let candidate = resolve(start);
  while (!existsSync(join(candidate, "infra/catalog/components.yaml"))) {
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error(
        "not inside a Kore repository (set KORE_ROOT to override)",
      );
    }
    candidate = parent;
  }
  return candidate;
}

/** The environments a repository defines: each has an `environment.yaml`. */
function environmentsIn(root: string): string[] {
  const base = join(root, "infra/environments");
  return readdirSync(base, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(base, entry.name, "environment.yaml")),
    )
    .map((entry) => entry.name)
    .sort();
}

/**
 * The environment integration specs test: `KORE_INTEGRATION_ENVIRONMENT`, or
 * `local` when it is unset or empty. The lock key and every spec's
 * `loadRepository` read it here, so the variable picks the cluster tested and
 * not only the lock taken. A name that is no environment of the repository is
 * refused up front, naming the variable and the valid environments.
 */
export function integrationEnvironment(start = process.cwd()): string {
  const given = process.env.KORE_INTEGRATION_ENVIRONMENT;
  const name = given === undefined || given === "" ? "local" : given;
  const valid = environmentsIn(repositoryRoot(start));
  if (!valid.includes(name)) {
    throw new Error(
      `KORE_INTEGRATION_ENVIRONMENT="${name}" is not an environment of this repository; use one of: ${valid.join(", ")}, or unset it for local`,
    );
  }
  return name;
}
