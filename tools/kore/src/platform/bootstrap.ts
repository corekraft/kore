import type { Repository } from "../config/index.js";
import {
  enabledComponents,
  featureEnabled,
  gatewayRollbackOrderFlag,
  isLocalProvider,
} from "../config/index.js";
import {
  assertExpectedCluster,
  ClusterUnavailableError,
  clusterUp,
} from "../cluster/index.js";
import {
  applyChartCredential,
  ensureLocalSigningPublicKey,
  ensureRegistryAuth,
  ensureRegistryTrust,
} from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import { closeExistingAdmissionGate } from "./admission-gate.js";
import { assertNoOrphanedReleases } from "./gated-release.js";
// The gate's open and close operations live in readiness-gate.ts.
export {
  closeGateIfDegraded,
  openApplicationAdmission,
} from "./readiness-gate.js";
export type { GateCheckResult } from "./readiness-gate.js";
import {
  ensureKeycloakProviderCredentials,
  ensurePortalSecrets,
} from "./portal-secrets.js";
import { reconcileIfNeeded } from "./reconcile.js";

async function ensureCluster(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  if (!isLocalProvider(repository.environment)) {
    await assertExpectedCluster(repository, runner);
    return;
  }
  try {
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
  for (const component of enabledComponents(repository)) {
    if (
      component.phase === "configuration" ||
      component.phase === "enforcement"
    ) {
      continue;
    }
    // The registry proxy mounts these Secrets, so they precede its release
    // (ADR 0034). Existing credentials are reused, never rotated.
    if (component.name === "oci-registry") {
      await ensureRegistryAuth(repository, runner);
    }
    await reconcileIfNeeded(repository, runner, component);
    // Argo CD is installed, so it gets the registry's read identity before
    // kore-config-delivery creates the Applications that pull charts with it
    // (ADR 0034). A no-op unless `platform up` composed the delivery values.
    if (component.name === "argocd") {
      await applyChartCredential(repository, runner);
    }
    // The operator's chart creates the keycloak namespace, so the Secrets the
    // platform Keycloak and Backstage read (the bootstrap admin, the sign-in
    // secrets) are streamed in right after it (ADR 0034). Present only with
    // platform-portal on.
    if (component.name === "keycloak-operator") {
      await ensurePortalSecrets(repository, runner);
    }
    // The provider's ClusterProviderConfig reads this credential, built from
    // the admin Secret above, so it follows the provider's install (ADR 0034).
    if (component.name === "keycloak-provider") {
      await ensureKeycloakProviderCredentials(repository, runner);
    }
    // The CA exists once the registry's certificate is issued. Clients that
    // live in the cluster (the node's containerd, Policy Controller) get it
    // before anything that depends on the registry runs (ADR 0058), and it is
    // reapplied unchanged on every run, so an existing profile migrates from
    // HTTP to HTTPS with no manual step.
    if (component.name === "oci-registry") {
      await ensureRegistryTrust(repository, runner);
    }
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
