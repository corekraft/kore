import type { Repository } from "./types.js";

/** Platform-wide status rows (not components) a requirement may name. */
export const platformChecks = ["registry-trust", "image-inventory"] as const;

/**
 * Validates the readiness manifest (ADR 0067): a supported version, steps 7 to
 * 11, and every catalog component required by exactly one requirement, so a
 * component added to the catalog cannot be left out of what opens the gate.
 */
export function readinessErrors({
  readiness,
  catalog,
}: Pick<Repository, "readiness" | "catalog">): string[] {
  const errors: string[] = [];
  if (readiness.version !== 1) {
    errors.push(
      `readiness manifest version ${String(readiness.version)} is unsupported: this kore reads version 1`,
    );
  }
  const known = new Set((catalog.components ?? []).map(({ name }) => name));
  const owner = new Map<string, string>();
  const names = new Set<string>();
  for (const requirement of readiness.requirements ?? []) {
    if (names.has(requirement.name)) {
      errors.push(`duplicate requirement ${requirement.name}`);
    }
    names.add(requirement.name);
    if (requirement.step < 7 || requirement.step > 11) {
      errors.push(
        `requirement ${requirement.name}: step ${requirement.step} must be between 7 and 11`,
      );
    }
    for (const component of requirement.components ?? []) {
      if (!known.has(component)) {
        errors.push(
          `requirement ${requirement.name} names unknown component ${component}`,
        );
      } else if (owner.has(component)) {
        errors.push(
          `component ${component} is required by more than one requirement (${owner.get(component)} and ${requirement.name})`,
        );
      } else {
        owner.set(component, requirement.name);
      }
    }
    for (const check of requirement.platformChecks ?? []) {
      if (!(platformChecks as readonly string[]).includes(check)) {
        errors.push(
          `requirement ${requirement.name} names unknown platform check ${check}`,
        );
      }
    }
  }
  for (const name of known) {
    if (!owner.has(name)) {
      errors.push(
        `readiness manifest does not require component ${name}: add it to a requirement in infra/catalog/readiness.yaml`,
      );
    }
  }
  return errors;
}
