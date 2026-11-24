import type { Component, Repository } from "../config/index.js";
import { componentGatedOff } from "../config/index.js";
import { purgeRetainedResources, retainedResources } from "../cluster/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { errorMessage, helmReleaseStatus } from "./probe.js";

export interface UninstallOptions {
  /** The destructive-consent gate: without it nothing is removed. */
  yes: boolean;
  /** The second opt-in: retained data of the release's namespace is deleted with it. */
  purgeData: boolean;
}

export interface UninstallResult {
  status: "absent" | "uninstalled";
  name: string;
  namespace: string;
}

function findComponent(repository: Repository, name: string): Component {
  const component = repository.catalog.components.find(
    (candidate) => candidate.name === name,
  );
  if (!component) {
    throw new Error(
      `no component named ${name} in environment ${repository.environment.name}; name a component from the catalog`,
    );
  }
  return component;
}

/** Whether the component's release is still installed. Any failure other than not-found is never read as absent. */
async function releaseInstalled(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<boolean> {
  try {
    await helmReleaseStatus(repository, runner, component);
    return true;
  } catch (error) {
    if (
      error instanceof CommandError &&
      /release: not found/.test(error.result.stderr)
    ) {
      return false;
    }
    throw new Error(
      `kore cannot check whether release ${component.name} remains in ${component.namespace}: ${errorMessage(error)}`,
    );
  }
}

/** The named component, once it is a Helm release whose feature flag is off. */
function gatedReleaseOf(repository: Repository, name: string): Component {
  const component = findComponent(repository, name);
  const { name: environment } = repository.environment;
  if (component.kind === "manifest") {
    throw new Error(
      `${name} is a manifest component and has no Helm release to uninstall`,
    );
  }
  if (!componentGatedOff(repository.environment, component)) {
    const reason = component.featureFlag
      ? `feature ${component.featureFlag} is on in ${environment}`
      : "it has no feature flag";
    throw new Error(
      `${name} is not gated off: ${reason}; kore uninstalls only the release of a turned-off feature flag`,
    );
  }
  return component;
}

/** Runs `helm uninstall` for exactly this release, then proves it is gone. */
async function removeRelease(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<void> {
  const { kubeContext } = repository.environment;
  const { name, namespace, timeout } = component;
  await runner.run(
    "helm",
    [
      "uninstall",
      name,
      "--namespace",
      namespace,
      "--kube-context",
      kubeContext,
      "--wait",
      "--timeout",
      timeout,
    ],
    { capture: false },
  );
  if (await releaseInstalled(repository, runner, component)) {
    throw new Error(
      `release ${name} is still installed in ${namespace} after uninstall; check it with helm status ${name} --namespace ${namespace} --kube-context ${kubeContext}`,
    );
  }
}

/**
 * Uninstalls the Helm release of a turned-off feature flag, the explicit step
 * ADR 0150 names: a rollback by flag-off ends here, never by pruning. It touches
 * only the named release, in the environment's configured context, and only
 * once the flag is off. Without `yes` it removes nothing and throws the plan.
 *
 * Retained data in the release's namespace needs `purgeData`, and it is refused
 * when another component shares that namespace, because the purge is scoped to
 * the namespace and could delete data that belongs to the other component.
 */
export async function uninstallGatedRelease(
  repository: Repository,
  runner: Runner,
  name: string,
  options: UninstallOptions,
): Promise<UninstallResult> {
  const component = gatedReleaseOf(repository, name);
  const { namespace } = component;
  const { kubeContext } = repository.environment;
  if (!(await releaseInstalled(repository, runner, component))) {
    return { status: "absent", name, namespace };
  }

  const retained = await retainedResources(repository, runner, namespace);
  const sharedWith = repository.catalog.components
    .filter((other) => other !== component && other.namespace === namespace)
    .map((other) => other.name);
  if (retained.length && sharedWith.length) {
    throw new Error(
      `release ${name} shares namespace ${namespace} with ${sharedWith.join(", ")} and the namespace holds retained data (${retained.join(", ")}); uninstall cannot tell that data from theirs, so nothing was removed`,
    );
  }

  const target = `release ${name} from namespace ${namespace} in kube context ${kubeContext}`;
  if (!options.yes) {
    const data = retained.length
      ? `, deleting its retained data (${retained.join(", ")})`
      : "";
    throw new Error(
      `would uninstall ${target}${data}. Nothing was removed. Repeat with --yes${retained.length ? " --purge-data" : ""} to uninstall it.`,
    );
  }
  if (retained.length && !options.purgeData) {
    throw new Error(
      `release ${name} holds retained data in ${namespace} (${retained.join(", ")}); repeat with --purge-data to delete it with the release`,
    );
  }
  if (retained.length) {
    await purgeRetainedResources(repository, runner, namespace);
  }
  await removeRelease(repository, runner, component);
  return { status: "uninstalled", name, namespace };
}
