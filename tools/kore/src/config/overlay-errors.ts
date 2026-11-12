import { join } from "node:path";
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
