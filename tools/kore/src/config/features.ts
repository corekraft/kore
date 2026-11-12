import type { Environment } from "./types.js";

/** Whether a flag is on in an environment; a flag the overlay omits is off. */
export function featureEnabled(
  environment: Pick<Environment, "features">,
  flag: string,
): boolean {
  return environment.features?.[flag] === true;
}

/** Helm arguments that hand every declared flag to a chart as a boolean. */
export function featureHelmArgs(
  environment: Pick<Environment, "features">,
): string[] {
  return Object.entries(environment.features ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([flag, on]) => ["--set", `features.${flag}=${on}`]);
}

/** The flag that selects agentgateway over Istio as the ingress GatewayClass. */
export const ingressFlag = "ingress-agentgateway";

/** The GatewayClass the platform Gateway uses, derived from the ingress flag. */
export function gatewayClassName(
  environment: Pick<Environment, "features">,
): string {
  return featureEnabled(environment, ingressFlag) ? "agentgateway" : "istio";
}
