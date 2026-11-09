import type { Repository } from "../config/index.js";
import { orderedComponents } from "../config/index.js";
import {
  assertExpectedCluster,
  ClusterUnavailableError,
  clusterUp,
} from "../cluster/index.js";
import {
  ensureLocalSigningPublicKey,
  ensureRegistryAuth,
  ensureRegistryTrust,
} from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import { closeExistingAdmissionGate } from "./admission-gate.js";
import { rewireRegistryService } from "./registry-rewire.js";
// The gate's open and close operations live in readiness-gate.ts.
export {
  closeGateIfDegraded,
  openApplicationAdmission,
} from "./readiness-gate.js";
export type { GateCheckResult } from "./readiness-gate.js";
import { reconcileComponent, reconcileIfNeeded } from "./reconcile.js";

async function ensureCluster(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  if (repository.environment.provider !== "minikube") {
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

export async function bootstrapControllers(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  await ensureCluster(repository, runner);
  await closeApplicationAdmission(repository, runner);
  for (const component of orderedComponents(repository.catalog)) {
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
    // A deployed release is normally only awaited, but a rewired registry
    // Service must be recreated by Helm, so that release reconciles anyway.
    if (
      component.name === "oci-registry" &&
      repository.environment.provider === "minikube" &&
      (await rewireRegistryService(repository, runner, (message) =>
        process.stderr.write(`${message}\n`),
      ))
    ) {
      await reconcileComponent(repository, runner, component);
      await ensureRegistryTrust(repository, runner);
      continue;
    }
    await reconcileIfNeeded(repository, runner, component);
    // The CA exists once the registry's certificate is issued. Clients that
    // live in the cluster (the node's containerd, Policy Controller) get it
    // before anything that depends on the registry runs (ADR 0058), and it is
    // reapplied unchanged on every run, so an existing profile migrates from
    // HTTP to HTTPS with no manual step.
    if (component.name === "oci-registry") {
      await ensureRegistryTrust(repository, runner);
    }
  }
  if (repository.environment.provider === "minikube") {
    // Policy Controller is ready; kore-image-policy (configuration phase)
    // references this public-key Secret, so it must exist first (ADR 0028).
    await ensureLocalSigningPublicKey(repository, runner);
  }
}
