import { orderedComponents } from "./order.js";
import type { Component, Environment, Repository } from "./types.js";

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

/** Whether a component's feature flag is off, so it is never installed. */
export function componentGatedOff(
  environment: Pick<Environment, "features">,
  component: Pick<Component, "featureFlag">,
): boolean {
  return (
    component.featureFlag !== undefined &&
    !featureEnabled(environment, component.featureFlag)
  );
}

/** Catalog components the environment installs, in dependency order. */
export function enabledComponents(repository: Repository): Component[] {
  return orderedComponents(repository.catalog).filter(
    (component) => !componentGatedOff(repository.environment, component),
  );
}

/** The flag that lets a local build reuse the image an earlier run published for the same source (#344). */
export const localImageReuseFlag = "local-image-reuse";

/** The flag that lets `kore local up` prune old per-run tags from the registry (ADR 0094). */
export const registryPruneFlag = "registry-tag-pruning";

/** The flag that installs metrics-server and turns on autoscaling defaults (ADR 0047). */
export const autoscalingFlag = "autoscaling-defaults";

/** The flag that installs the Organization and Service platform APIs, for the platform organization only (plan 15 step 2). */
export const organizationServiceApisFlag = "platform-organization-service-apis";

/** The flag that installs the platform organization's Argo CD in the core phase (ADR 0043, plan 15 step 5). */
export const platformArgocdDeliveryFlag = "platform-argocd-delivery";

/** The flag that gates the platform organization's portal: its Keycloak and, later, its Backstage (ADR 0113, plan 15 step 6). */
export const platformPortalFlag = "platform-portal";
