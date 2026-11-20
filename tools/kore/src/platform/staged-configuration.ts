import {
  enabledComponents,
  startsAfterDelivery,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { reconcileConfiguration } from "./reconcile.js";
import { prepareConfigurationRelease } from "./release-prerequisites.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

/**
 * Reconciles the enabled releases that start after the Argo CD delivery, in
 * catalog order: the platform Keycloak, then Backstage, which needs the realm
 * Keycloak serves. They run once the Applications are Synced and Healthy, so
 * Keycloak's start is not added to the burst of Argo CD's first sync and the
 * rest of the install. Each release is prepared as any configuration release
 * is, and one that fails stops the rest, so Backstage never starts without
 * Keycloak. With portal-staged-install off, nothing runs.
 */
export async function reconcileStagedConfigurations(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  for (const component of enabledComponents(repository)) {
    if (!startsAfterDelivery(repository.environment, component)) {
      continue;
    }
    await prepareConfigurationRelease(repository, runner, component);
    await reconcileConfiguration(repository, runner, component);
  }
}
