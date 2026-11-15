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

/** The enabled releases kore installs through Helm, never one that argo cd owns. */
export function helmInstalledComponents(repository: Repository): Component[] {
  return enabledComponents(repository).filter(
    (component) => releaseOwner(repository.environment, component) === "kore",
  );
}
