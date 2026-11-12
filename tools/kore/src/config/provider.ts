import type { Environment } from "./types.js";

/**
 * Whether the environment's cluster is a local development cluster that Kore
 * creates, trusts and signs images for (k3d). Managed clusters are provisioned
 * elsewhere and need no local trust.
 */
export function isLocalProvider(
  environment: Pick<Environment, "provider">,
): boolean {
  return environment.provider === "k3d";
}
