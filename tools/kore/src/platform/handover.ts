import {
  configDeliveryRelease,
  enabledComponents,
  helmInstalledComponents,
  releaseOwner,
  type Component,
  type Repository,
} from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { helmReleaseStatus } from "./probe.js";
import { reconcileConfiguration } from "./reconcile.js";
import { prepareConfigurationRelease } from "./release-prerequisites.js";
import { waitForApplications } from "./readiness-argocd.js";
import { ReadinessTimeout, pollUntil } from "./readiness-poll.js";
import { readinessFailure } from "./readiness.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the safe order, step 4)

export { reconcileStagedConfigurations } from "./staged-configuration.js";

/**
 * Reconciles each configuration and enforcement release Helm still owns. An
 * Argo CD owned release is skipped once Argo CD has taken it over (see
 * handedToArgocd), so Helm never reconciles it after the handover. A release
 * that starts after the delivery is left for the staged pass.
 */
export async function reconcileConfigurations(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const candidates = helmInstalledComponents(repository, false);
  for (const component of candidates) {
    if (
      (component.phase !== "configuration" &&
        component.phase !== "enforcement") ||
      component.startsAfterDelivery === true
    ) {
      continue;
    }
    await prepareConfigurationRelease(repository, runner, component);
    if (await handedToArgocd(repository, runner, candidates, component)) {
      continue;
    }
    await reconcileConfiguration(repository, runner, component);
  }
}

/**
 * True when Argo CD owns the release and has taken it over: Helm skips it only
 * once `kore-config-delivery` is deployed, read from the cluster so a rerun
 * after a failed delivery leaves Helm managing it (ADR 0043).
 */
async function handedToArgocd(
  repository: Repository,
  runner: Runner,
  candidates: readonly Component[],
  component: Component,
): Promise<boolean> {
  if (helmInstalledComponents(repository, true).includes(component)) {
    return false;
  }
  const delivery = candidates.find((c) => c.name === configDeliveryRelease);
  return (
    delivery !== undefined && (await isDeployed(repository, runner, delivery))
  );
}

/** A release that does not exist yet is not deployed; any other failure is rethrown. */
async function isDeployed(
  repository: Repository,
  runner: Runner,
  release: Component,
): Promise<boolean> {
  try {
    return (
      (await helmReleaseStatus(repository, runner, release)) === "deployed"
    );
  } catch (error) {
    if (
      error instanceof CommandError &&
      /release: not found/.test(error.result.stderr)
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Waits until Argo CD has delivered what it owns, before the admission gate is
 * judged. Helm waited for each release it installed (`--wait`); Argo CD syncs
 * asynchronously, so one read after the handover races it. Every Application
 * kore-config-delivery created must be Synced and Healthy first, then each Argo
 * CD owned release must pass its own readiness checks, each within its catalog
 * timeout. A timeout names what is not ready and its last state. With no
 * release owned by Argo CD, which is the flag off, nothing waits.
 */
export async function awaitArgocdDelivery(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const components = enabledComponents(repository);
  const owned = components.filter(
    (component) => releaseOwner(repository.environment, component) === "argocd",
  );
  if (owned.length === 0) {
    return;
  }
  const delivery = components.find(
    ({ name }) => name === configDeliveryRelease,
  );
  if (delivery === undefined) {
    throw new Error(
      `${configDeliveryRelease} is not enabled, so the Applications that Argo CD owns cannot be awaited; enable its featureFlag or clear owner: argocd on the releases`,
    );
  }
  await waitForApplications(
    {
      repository,
      runner,
      base: [
        "--context",
        repository.environment.kubeContext,
        "--namespace",
        delivery.namespace,
      ],
    },
    delivery.timeout,
  );
  for (const component of owned) {
    await awaitRelease(repository, runner, component);
  }
}

/**
 * Polls a release's readiness within its own timeout. Only a timeout is
 * reported as one, naming the release and the command that describes its first
 * readiness resource; any other error (Forbidden, unreachable context) is
 * rethrown as itself.
 */
async function awaitRelease(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<void> {
  try {
    await pollUntil(component.timeout, () =>
      readinessFailure(repository, runner, component),
    );
  } catch (error) {
    if (!(error instanceof ReadinessTimeout)) {
      throw error;
    }
    const [resource = component.name] = component.readiness;
    throw new Error(
      `argocd-owned release ${component.name} is not ready after ${component.timeout}: ${error.message}; run kubectl --context ${repository.environment.kubeContext} -n ${component.namespace} describe ${resource}`,
    );
  }
}
