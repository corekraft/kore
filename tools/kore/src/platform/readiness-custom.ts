import { argocdApplicationsCheck } from "./readiness-argocd.js";
import { clientCheck } from "./readiness-client.js";
import { existenceCheck } from "./readiness-existence.js";
import { gatewayCheck, type GatewayContext } from "./readiness-gateway.js";
import { openbaoCheck } from "./readiness-openbao.js";
import { organizationCheck } from "./readiness-organization.js";

/**
 * The readiness check for a resource proven by its own reported status rather
 * than a rollout: the Argo CD Application collection, a Gateway or an
 * HTTPRoute, or a resource an operator creates after its release is installed
 * (a StatefulSet, the Keycloak realm), or the OpenBao StatefulSet, whose pod probe
 * names no cause and never reads the audit device. Undefined for any other resource.
 */
export function customCheck(
  context: GatewayContext & { capture?: boolean },
  resource: string,
): { condition: string; run: (timeout: string) => Promise<void> } | undefined {
  return (
    argocdApplicationsCheck(context, resource) ??
    gatewayCheck(context, resource) ??
    organizationCheck(context, resource) ??
    clientCheck(context, resource) ??
    openbaoCheck(context, resource) ??
    existenceCheck(context, resource)
  );
}
