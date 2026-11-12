import type { Component, Repository } from "../config/index.js";
import { componentGatedOff, enabledComponents } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { errorMessage, helmReleaseStatus } from "./probe.js";

/**
 * A flag turned off after install leaves a release no desired state owns. This
 * read-only check (`helm status`) names it and the fix. Only Helm components
 * are checked: validation refuses a flag on a manifest component, which has no
 * release to look up. Any failure
 * other than "release: not found" is a problem too, never a clean gated-off.
 */
export async function gatedReleaseProblem(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<string | undefined> {
  if (component.kind === "manifest") {
    return undefined;
  }
  const { name, namespace, featureFlag } = component;
  const { kubeContext, name: environment } = repository.environment;
  try {
    await helmReleaseStatus(repository, runner, component);
  } catch (error) {
    if (
      error instanceof CommandError &&
      /release: not found/.test(error.result.stderr)
    ) {
      return undefined;
    }
    return `${name} is gated off (feature ${featureFlag} is off in ${environment}) but kore cannot check whether its release remains in ${namespace}: ${errorMessage(error)}`;
  }
  return `${name} is gated off (feature ${featureFlag} is off in ${environment}) but its release is still installed in ${namespace}; run helm uninstall ${name} --namespace ${namespace} --kube-context ${kubeContext}, or turn feature ${featureFlag} back on`;
}

/** Gated-off components whose release still exists, each with its problem. */
export async function orphanedGatedComponents(
  repository: Repository,
  runner: Runner,
): Promise<{ component: Component; problem: string }[]> {
  const orphans: { component: Component; problem: string }[] = [];
  for (const component of repository.catalog.components) {
    if (!componentGatedOff(repository.environment, component)) {
      continue;
    }
    const problem = await gatedReleaseProblem(repository, runner, component);
    if (problem) {
      orphans.push({ component, problem });
    }
  }
  return orphans;
}

/** Fails while a gated-off release remains, before any component is installed. */
export async function assertNoOrphanedReleases(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const orphans = await orphanedGatedComponents(repository, runner);
  if (orphans.length) {
    throw new Error(orphans.map(({ problem }) => problem).join("; "));
  }
}

/**
 * Namespaces the platform manages: those of enabled components, plus those of
 * gated-off components whose release still exists, so enrollment and the image
 * inventory keep covering what is still running.
 */
export async function managedNamespaces(
  repository: Repository,
  runner: Runner,
): Promise<string[]> {
  const orphans = await orphanedGatedComponents(repository, runner);
  return [
    ...new Set(
      [
        ...enabledComponents(repository),
        ...orphans.map(({ component }) => component),
      ].map(({ namespace }) => namespace),
    ),
  ].sort();
}
