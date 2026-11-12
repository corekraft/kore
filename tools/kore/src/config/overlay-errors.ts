import { join } from "node:path";
import { componentGatedOff } from "./features.js";
import { exists } from "./files.js";
import type { Component, Environment, Repository } from "./types.js";

const flagName = /^[a-z][a-z0-9-]*$/;

/** Schema errors for `environment.features`, found before any mutation. */
function featureErrors(environment: Environment): string[] {
  const features: unknown = environment.features;
  if (features === undefined) {
    return [];
  }
  if (!features || typeof features !== "object" || Array.isArray(features)) {
    return ["environment.features must be a map of flag name to true or false"];
  }
  return Object.entries(features).flatMap(([flag, value]) => [
    ...(flagName.test(flag)
      ? []
      : [
          `environment.features name ${flag} must be lowercase letters, digits and hyphens, starting with a letter`,
        ]),
    ...(typeof value === "boolean"
      ? []
      : [`environment.features.${flag} must be true or false`]),
  ]);
}

/** A gated component must reference a flag the environment declares. */
function featureFlagErrors(
  environment: Environment,
  components: Component[],
): string[] {
  const declared = new Set(Object.keys(environment.features ?? {}));
  return components.flatMap(({ name, featureFlag }) => {
    if (featureFlag === undefined) {
      return [];
    }
    if (!flagName.test(featureFlag)) {
      return [
        `${name}: featureFlag ${featureFlag} must be lowercase letters, digits and hyphens, starting with a letter`,
      ];
    }
    return declared.has(featureFlag)
      ? []
      : [
          `${name}: featureFlag ${featureFlag} is not declared in environment.features; add "${featureFlag}": false to the ${environment.name} environment overlay`,
        ];
  });
}

/** An enabled component cannot depend on one its flag gates off. */
function gatedDependencyErrors(
  environment: Environment,
  components: Component[],
): string[] {
  const byName = new Map(components.map((c) => [c.name, c]));
  return components.flatMap((component) => {
    if (componentGatedOff(environment, component)) {
      return [];
    }
    return component.dependencies.flatMap((dependency) => {
      const target = byName.get(dependency);
      return target && componentGatedOff(environment, target)
        ? [
            `${component.name}: depends on ${dependency}, which feature ${target.featureFlag} gates off; gate ${component.name} with the same flag or drop the dependency`,
          ]
        : [];
    });
  });
}

function unknownOverlayErrors(
  environment: Environment,
  names: Set<string>,
): string[] {
  return Object.keys(environment.componentValues ?? {})
    .filter((componentName) => !names.has(componentName))
    .map(
      (componentName) =>
        `unknown environment component values: ${componentName}`,
    );
}

async function componentSourceErrors(
  repository: Repository,
  manifests: Set<string>,
): Promise<string[]> {
  const sources = Object.entries(repository.environment.componentSources ?? {});
  const present = await Promise.all(
    sources.map(([, path]) => exists(join(repository.root, path))),
  );
  return sources.flatMap(([component, path], index) => [
    ...(manifests.has(component)
      ? []
      : [
          `environment component source for a non-manifest component: ${component}`,
        ]),
    ...(present[index]
      ? []
      : [`${component}: environment source does not exist: ${path}`]),
  ]);
}

async function missingValueFileErrors(
  repository: Repository,
  component: Component,
): Promise<string[]> {
  const candidates = [
    ...(component.values ?? []).map((path) => ({
      path,
      message: `${component.name}: values file does not exist: ${path}`,
    })),
    ...(repository.environment.componentValues?.[component.name] ?? []).map(
      (path) => ({
        path,
        message: `${component.name}: environment values file does not exist: ${path}`,
      }),
    ),
  ];
  const present = await Promise.all(
    candidates.map(({ path }) => exists(join(repository.root, path))),
  );
  return candidates
    .filter((_, index) => !present[index])
    .map(({ message }) => message);
}

/** Every error in the environment overlay and the files it points at. */
export async function overlayErrors(repository: Repository): Promise<string[]> {
  const { environment, catalog } = repository;
  const components: Component[] = catalog.components ?? [];
  const names = new Set(components.map((component) => component.name));
  const manifests = new Set(
    components.filter((c) => c.kind === "manifest").map((c) => c.name),
  );
  return [
    ...featureErrors(environment),
    ...featureFlagErrors(environment, components),
    ...gatedDependencyErrors(environment, components),
    ...unknownOverlayErrors(environment, names),
    ...(await componentSourceErrors(repository, manifests)),
    ...(
      await Promise.all(
        components.map((component) =>
          missingValueFileErrors(repository, component),
        ),
      )
    ).flat(),
  ];
}
