import {
  enabledComponents,
  featureEnabled,
  platformArgocdDeliveryFlag,
} from "./features.js";
import type { Component, Environment, Owner, Repository } from "./types.js";

/**
 * The one desired-state owner of a release in an environment (ADR 0043). A
 * release declares `owner: argocd` in the catalog, but it is handed over only
 * while `platform-argocd-delivery` is on, so with the flag off kore owns
 * every release, as before.
 */
export function releaseOwner(
  environment: Pick<Environment, "features">,
  component: Pick<Component, "owner">,
): Owner {
  return component.owner === "argocd" &&
    featureEnabled(environment, platformArgocdDeliveryFlag)
    ? "argocd"
    : "kore";
}

/** The release that creates the Argo CD AppProject and Applications (ADR 0043). */
export const configDeliveryRelease = "kore-config-delivery";

/**
 * The enabled releases kore installs through Helm. An argocd-owned release is
 * skipped only once `kore-config-delivery` is installed, so Argo CD can take
 * it over and there is never a window with no owner (ADR 0043). With the flag
 * off nothing is argocd-owned, so `deliveryInstalled` changes nothing.
 */
export function helmInstalledComponents(
  repository: Repository,
  deliveryInstalled: boolean,
): Component[] {
  return enabledComponents(repository).filter(
    (component) =>
      !deliveryInstalled ||
      releaseOwner(repository.environment, component) === "kore",
  );
}
