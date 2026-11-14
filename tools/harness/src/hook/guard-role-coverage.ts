// The guard role coverage check: which registry roles no spec case names, and which spec roles
// the registry lacks. Pure, so the CI gate in guard-corpus.spec.ts and its own spec run it the same way.

export interface RoleCoverage {
  /** Registry roles that no spec case names, sorted. */
  missing: string[];
  /** Roles a spec case names that the registry lacks, sorted and without repeats. */
  extra: string[];
}

export function roleCoverage(
  registry: readonly string[],
  specRoles: readonly string[],
): RoleCoverage {
  const registered = new Set(registry);
  const named = new Set(specRoles);
  return {
    missing: [...registered].filter((role) => !named.has(role)).sort(),
    extra: [...named].filter((role) => !registered.has(role)).sort(),
  };
}
