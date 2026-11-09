import type { Catalog, Component, Phase } from "./types.js";

const phaseOrder: Record<Phase, number> = {
  bootstrap: 0,
  core: 1,
  observability: 2,
  configuration: 3,
  enforcement: 4,
};

function dependentsOf(components: Component[]): Map<string, string[]> {
  const dependents = new Map<string, string[]>();
  for (const component of components) {
    for (const dependency of component.dependencies) {
      dependents.set(dependency, [
        ...(dependents.get(dependency) ?? []),
        component.name,
      ]);
    }
  }
  return dependents;
}

function phaseThenName(
  byName: Map<string, Component>,
): (left: string, right: string) => number {
  const rank = (key: string): number =>
    phaseOrder[byName.get(key)?.phase ?? "enforcement"];
  return (left, right) => rank(left) - rank(right) || left.localeCompare(right);
}

function drain(
  byName: Map<string, Component>,
  degree: Map<string, number>,
  dependents: Map<string, string[]>,
  compare: (left: string, right: string) => number,
): Component[] {
  const ready = [...degree.entries()]
    .filter(([, value]) => value === 0)
    .map(([key]) => key)
    .sort(compare);
  const result: Component[] = [];
  while (ready.length) {
    const current = ready.shift()!;
    const component = byName.get(current);
    if (component) {
      result.push(component);
    }
    for (const child of (dependents.get(current) ?? []).sort(compare)) {
      const next = (degree.get(child) ?? 0) - 1;
      degree.set(child, next);
      if (next === 0) {
        ready.push(child);
        ready.sort(compare);
      }
    }
  }
  return result;
}

export function orderedComponents(catalog: Catalog): Component[] {
  const { components } = catalog;
  const byName = new Map(
    components.map((component) => [component.name, component]),
  );
  const degree = new Map(
    components.map((component) => [
      component.name,
      component.dependencies.length,
    ]),
  );
  const result = drain(
    byName,
    degree,
    dependentsOf(components),
    phaseThenName(byName),
  );
  if (result.length !== components.length) {
    const cycle = [...degree.entries()]
      .filter(([, value]) => value > 0)
      .map(([key]) => key)
      .sort();
    throw new Error(`release dependency cycle includes: ${cycle.join(", ")}`);
  }
  return result;
}

// Catalog coverage by the readiness manifest is validated beside ordering.
export { readinessErrors } from "./readiness.js";
