import type { FlagEntry, FlagKind, FlagManifest, Repository } from "./types.js";

// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md

/** The manifest's path, read by `loadRepository` and named in every flag error. */
export const flagManifestPath = "infra/catalog/flags.yaml";

const flagName = /^[a-z][a-z0-9-]*$/;
const environmentName = /^[a-z0-9-]+$/;
const kinds = new Set<FlagKind>(["feature", "environment", "harness"]);

/** The entry for a flag name, or undefined when the manifest does not declare it. */
export function flagEntry(
  manifest: FlagManifest,
  name: string,
): FlagEntry | undefined {
  return manifest.flags.find((entry) => entry.name === name);
}

/** Whether a flag is marked never-retire: only an environment flag is, and it is never retired (ADR 0148). */
export function neverRetires(manifest: FlagManifest, name: string): boolean {
  return flagEntry(manifest, name)?.neverRetire === true;
}

/**
 * The flags that apply to an environment, in manifest order. A pending flag is
 * left out until its decision lands, and a flag not applicable to the
 * environment is left out too (ADR 0148).
 */
export function appliedFlags(
  manifest: FlagManifest,
  environment: string,
): string[] {
  return manifest.flags
    .filter(
      (entry) =>
        !entry.pending &&
        entry.applies.includes(environment) &&
        !entry.notApplicable?.includes(environment),
    )
    .map((entry) => entry.name);
}

/**
 * The reason a flag is not applicable to an environment, or undefined when it
 * applies there or the manifest does not declare it (ADR 0148).
 */
export function notApplicableReason(
  manifest: FlagManifest,
  name: string,
  environment: string,
): string | undefined {
  const entry = flagEntry(manifest, name);
  return entry?.notApplicable?.includes(environment) ? entry.reason : undefined;
}

/**
 * Errors of an entry's not-applicable mark: each environment it names must be
 * one its entry applies to, and each needs the one-line reason (ADR 0148).
 */
function notApplicableErrors(entry: FlagEntry): string[] {
  if (entry.notApplicable === undefined) {
    return [];
  }
  const envs = entry.notApplicable;
  if (
    !Array.isArray(envs) ||
    !envs.every((env) => typeof env === "string" && environmentName.test(env))
  ) {
    return [
      `flag ${entry.name} notApplicable must list environment names of lowercase letters, digits and hyphens (ADR 0148)`,
    ];
  }
  const applies = Array.isArray(entry.applies) ? entry.applies : [];
  const notListed = envs
    .filter((env) => !applies.includes(env))
    .map(
      (env) =>
        `flag ${entry.name} is marked not applicable to ${env} but its applies does not list ${env}; mark only an environment it applies to (ADR 0148)`,
    );
  const reasonIsLine =
    typeof entry.reason === "string" &&
    entry.reason.trim() !== "" &&
    !entry.reason.includes("\n");
  const reasonless = reasonIsLine
    ? []
    : envs.map(
        (env) =>
          `flag ${entry.name} is not applicable to ${env} and needs a one-line reason in ${flagManifestPath} (ADR 0148)`,
      );
  return [...notListed, ...reasonless];
}

/** Errors of the manifest's own entries: names, kinds, environments and marks. */
function entryErrors(manifest: FlagManifest): string[] {
  const seen = new Set<string>();
  return manifest.flags.flatMap((entry) => {
    const errors: string[] = [];
    if (seen.has(entry.name)) {
      errors.push(
        `flag ${entry.name} is declared more than once in ${flagManifestPath}`,
      );
    }
    seen.add(entry.name);
    if (!flagName.test(entry.name)) {
      errors.push(
        `flag ${entry.name} must be lowercase letters, digits and hyphens, starting with a letter`,
      );
    }
    if (!kinds.has(entry.kind)) {
      errors.push(
        `flag ${entry.name} kind must be feature, environment or harness`,
      );
    }
    const applies = Array.isArray(entry.applies) ? entry.applies : [];
    if (applies.length === 0) {
      errors.push(
        `flag ${entry.name} applies must list at least one environment`,
      );
    } else if (!applies.every((env) => environmentName.test(env))) {
      errors.push(
        `flag ${entry.name} applies must list environment names of lowercase letters, digits and hyphens`,
      );
    }
    if (entry.kind === "harness" && applies.some((env) => env !== "local")) {
      errors.push(
        `flag ${entry.name} is a harness flag and applies to more than local; only the local harness reads harness flags, so they apply to local alone and are inert on a managed environment (ADR 0148)`,
      );
    }
    if (entry.pending !== undefined && typeof entry.pending !== "boolean") {
      errors.push(`flag ${entry.name} pending must be true or false`);
    }
    if (
      entry.neverRetire !== undefined &&
      typeof entry.neverRetire !== "boolean"
    ) {
      errors.push(`flag ${entry.name} neverRetire must be true or false`);
    } else if (entry.neverRetire === true && entry.kind !== "environment") {
      errors.push(
        `flag ${entry.name} is marked neverRetire but is a ${entry.kind} flag; only an environment flag never retires (ADR 0148)`,
      );
    }
    return [...errors, ...notApplicableErrors(entry)];
  });
}

/**
 * Errors of each overlay flag against the manifest: a flag with no entry, and a
 * flag in an environment its entry does not list. A harness flag applies only to
 * the environments its entry lists, so one in a managed overlay is refused here
 * too (ADR 0148).
 */
function overlayFlagErrors(repository: Repository): string[] {
  const { environment, flags } = repository;
  const env = environment.name;
  return Object.keys(environment.features ?? {}).flatMap((name) => {
    const entry = flagEntry(flags, name);
    if (!entry) {
      return [
        `flag ${name} is in the ${env} overlay but has no entry in ${flagManifestPath}; add an entry with its kind and the environments it applies to (ADR 0148)`,
      ];
    }
    if (!entry.applies.includes(env)) {
      return [
        `flag ${name} is in the ${env} overlay but its entry applies to ${entry.applies.join(", ")} only; add ${env} to its applies or remove it from the ${env} overlay (ADR 0148)`,
      ];
    }
    if (
      environment.features?.[name] === true &&
      entry.notApplicable?.includes(env)
    ) {
      return [
        `flag ${name} is on in the ${env} overlay but ${flagManifestPath} marks it not applicable to ${env} (${entry.reason ?? "no reason given"}); keep it off there (ADR 0148)`,
      ];
    }
    return [];
  });
}

/** Every error of the flag manifest and of the overlay's flags checked against it. */
export function flagManifestErrors(repository: Repository): string[] {
  if (!Array.isArray(repository.flags?.flags)) {
    return [`${flagManifestPath} must declare a flags list`];
  }
  return [...entryErrors(repository.flags), ...overlayFlagErrors(repository)];
}
