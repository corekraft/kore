import { featureEnabled, keycloakWaitFlag } from "./features.js";
import type { Environment } from "./types.js";

/**
 * With platform-keycloak-wait on, the portal's pod waits for the Keycloak
 * realm's discovery before its proxy starts (issue 1788); otherwise none, so
 * the flag off renders what it rendered before. The portal is feature-free, so
 * kore hands this one boolean rather than the features map.
 */
export function keycloakWaitArgs(
  environment: Environment,
  component: string,
): string[] {
  return component === "kore-platform-backstage" &&
    featureEnabled(environment, keycloakWaitFlag)
    ? ["--set", "keycloakWait=true"]
    : [];
}
