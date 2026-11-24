import { valuesGatedOff } from "./features.js";
import type { Component, Repository } from "./types.js";

/**
 * The value files Helm takes for a component: its own, then the environment's for
 * it. A file its valuesFlags gates is left out while that flag is off, so it
 * reaches Helm only with the flag on (issue 1593).
 */
export function componentValues(
  repository: Repository,
  component: Component,
): string[] {
  return [
    ...(component.values ?? []),
    ...(repository.environment.componentValues?.[component.name] ?? []),
  ].filter((path) => !valuesGatedOff(repository.environment, component, path));
}
