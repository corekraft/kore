import { argocdApplicationsCheck } from "./readiness-argocd.js";
import { gatewayCheck, type GatewayContext } from "./readiness-gateway.js";

/**
 * The readiness check for a resource proven by its own reported status rather
 * than a rollout: the Argo CD Application collection, a Gateway or an
 * HTTPRoute. Undefined for any other resource.
 */
export function customCheck(
  context: GatewayContext,
  resource: string,
): { condition: string; run: (timeout: string) => Promise<void> } | undefined {
  return (
    argocdApplicationsCheck(context, resource) ??
    gatewayCheck(context, resource)
  );
}
