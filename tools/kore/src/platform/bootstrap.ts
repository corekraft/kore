import type { Repository } from "../config/index.js";
import {
  enabledComponents,
  featureEnabled,
  gatewayRollbackOrderFlag,
  isLocalProvider,
} from "../config/index.js";
import {
  assertExpectedCluster,
  assertRunningK3dMatchesOverlay,
  ClusterUnavailableError,
  clusterUp,
} from "../cluster/index.js";
import { ensureLocalSigningPublicKey } from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import { closeExistingAdmissionGate } from "./admission-gate.js";
import { bootstrapComponent } from "./bootstrap-component.js";
import { assertNoOrphanedReleases } from "./gated-release.js";
// The gate's open and close operations live in readiness-gate.ts.
export {
  closeGateIfDegraded,
  openApplicationAdmission,
} from "./readiness-gate.js";
export type { GateCheckResult } from "./readiness-gate.js";

async function ensureCluster(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  if (!isLocalProvider(repository.environment)) {
    await assertExpectedCluster(repository, runner);
    return;
  }
  try {
    await assertRunningK3dMatchesOverlay(repository, runner);
    await assertExpectedCluster(repository, runner);
  } catch (error) {
    if (!(error instanceof ClusterUnavailableError)) {
      throw error;
    }
    await clusterUp(repository, runner);
  }
}

/**
 * Starts a run with the application admission gate closed (ADR 0054), so a
 * failed or interrupted run, or a changed catalog, never leaves an open gate.
 */
export async function closeApplicationAdmission(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  await closeExistingAdmissionGate(repository, runner);
}

/**
 * With `gateway-rollback-order` on, a gated-off release is reported after
 * the components are reconciled, not before: `kore-platform-config` must be
 * re-rendered without the gated-off resources before the operator can safely
 * uninstall the release (ADR 0081 addendum). With the flag off the refusal
 * stays up front, before any mutation.
 */
export function orphanCheckDeferred(repository: Repository): boolean {
  return featureEnabled(repository.environment, gatewayRollbackOrderFlag);
}

export interface BootstrapOptions {
  /** `caller`: the caller runs the deferred orphan check after its own components. */
  orphanCheck?: "bootstrap" | "caller";
}

export async function bootstrapControllers(
  repository: Repository,
  runner: Runner,
  options: BootstrapOptions = {},
): Promise<void> {
  await ensureCluster(repository, runner);
  await closeApplicationAdmission(repository, runner);
  const deferred = orphanCheckDeferred(repository);
  if (!deferred) {
    await assertNoOrphanedReleases(repository, runner);
  }
  let gatekeeperInstalled = false;
  for (const component of enabledComponents(repository)) {
    if (
      component.phase === "configuration" ||
      component.phase === "enforcement"
    ) {
      continue;
    }
    await bootstrapComponent(
      repository,
      runner,
      component,
      gatekeeperInstalled,
    );
    gatekeeperInstalled ||= component.name === "gatekeeper";
  }
  if (isLocalProvider(repository.environment)) {
    // Policy Controller is ready; kore-image-policy (configuration phase)
    // references this public-key Secret, so it must exist first (ADR 0028).
    await ensureLocalSigningPublicKey(repository, runner);
  }
  if (deferred && options.orphanCheck !== "caller") {
    await assertNoOrphanedReleases(repository, runner);
  }
}
