import {
  configDeliveryRelease,
  helmInstalledComponents,
  type Component,
  type Repository,
} from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { helmReleaseStatus } from "./probe.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the safe order)

/**
 * True when Argo CD owns the release and has taken it over: Helm skips it only
 * once `kore-config-delivery` is deployed, read from the cluster so a rerun
 * after a failed delivery leaves Helm managing it (ADR 0043).
 */
export async function handedToArgocd(
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
