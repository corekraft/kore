import {
  configDeliveryRelease,
  helmInstalledComponents,
  isLocalProvider,
  type Component,
  type Repository,
} from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { installLocalTrust } from "../security/index.js";
import {
  bootstrapControllers,
  openApplicationAdmission,
  orphanCheckDeferred,
} from "./bootstrap.js";
import { assertNoOrphanedReleases } from "./gated-release.js";
import { enrollPlatformNamespaces } from "./enrollment.js";
import { writePlatformState } from "./platform-state.js";
import { helmReleaseStatus } from "./probe.js";
import { reconcileConfiguration } from "./reconcile.js";

export async function platformUp(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  await bootstrapControllers(repository, runner, { orphanCheck: "caller" });
  if (isLocalProvider(repository.environment)) {
    await installLocalTrust(repository, runner);
  }
  const candidates = helmInstalledComponents(repository, false);
  for (const component of candidates) {
    if (
      component.phase !== "configuration" &&
      component.phase !== "enforcement"
    ) {
      continue;
    }
    if (await handedToArgocd(repository, runner, candidates, component)) {
      continue;
    }
    await reconcileConfiguration(repository, runner, component);
  }
  // Deferred by `gateway-class-change-release`: the refusal comes once the
  // configuration is re-rendered, and still ends the run (ADR 0081 addendum).
  if (orphanCheckDeferred(repository)) {
    await assertNoOrphanedReleases(repository, runner);
  }
  // Every phase is done, so Policy Controller and the image policies are ready:
  // enforce environments enroll their namespaces now, before the inventory
  // judges them (ADR 0056).
  await enrollPlatformNamespaces(repository, runner);
  // Bootstrap closed the gate first; it opens only if every component is ready
  // after all phases of this run (ADR 0054).
  await openApplicationAdmission(repository, runner);
  await writePlatformState(repository, "ready");
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
