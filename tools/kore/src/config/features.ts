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

/** The flag that lets a reconcile delete and recreate the platform Gateway when its GatewayClass changes (plan 13 step 2). */
export const gatewayClassChangeFlag = "gateway-class-change-release";

/** The flag that defers the orphaned-release refusal until the components are reconciled, so a rollback can re-render platform-config first (plan 13 step 2, ADR 0081). */
export const gatewayRollbackOrderFlag = "gateway-rollback-order";

/** The flag that enrols only the agentgateway data-plane pod in the ambient mesh, with a permissive exception for its listener port (plan 13 step 3, ADR 0081). */
export const agentgatewayMeshEnrollmentFlag = "agentgateway-mesh-enrollment";

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

/**
 * Whether a readiness resource is skipped because the flag that creates it is
 * off: a component's readinessFlags names the flag per resource, so a resource
 * that exists only behind a flag is not waited on while the flag is off (issue 1884).
 */
export function readinessGatedOff(
  environment: Pick<Environment, "features">,
  component: { readinessFlags?: Record<string, string> | undefined },
  resource: string,
): boolean {
  const flag = component.readinessFlags?.[resource];
  return flag !== undefined && !featureEnabled(environment, flag);
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

/** The flag that installs the local-only platform DNS server, answering the platform domain zone with the loopback address (plan 15, issue 1202). */
export const platformDnsFlag = "platform-dns";

/** The flag that makes `kore local up` read a cluster's load balancer mappings from docker inspect when `k3d cluster list` reports none, so a missing declared port is refused (#1683). Off, the drift check reads the listing alone. */
export const driftListingMappingsFlag = "drift-listing-mappings";

/** The flag that installs the hostname-ownership constraint and the zone field it reads from the Organization API (ADR 0042, issue 1331). */
export const platformHostnameOwnershipFlag = "platform-hostname-ownership";

/** The flag that makes host-side digest lookup, cosign and pruning reach the registry by name through a passthrough route (ADR 0132, issue 1219); a k3d environment needs it on, since its local port-forward is retired (#1226). */
export const registryByNameFlag = "registry-by-name";

/** The flag that makes cert-manager create the cluster's own root CA, so the CA key never leaves a managed cluster; k3d environments take theirs from kore trust install (ADR 0142). */
export const inClusterCaFlag = "in-cluster-ca";

/** The flag that lets the controller reach a managed cluster's in-cluster registry through a kubectl port-forward over its own context, across the tailnet (ADR 0143, issue 1404). */
export const registryTailnetForwardFlag = "registry-tailnet-forward";

/** The flag that gates the platform organization's portal: its Keycloak and, later, its Backstage (ADR 0113, plan 15 step 6). */
export const platformPortalFlag = "platform-portal";

/** The flag that makes the golden-path sign-in wait for the portal's Keycloak instead of the delivery gate (ADR 0113, issue 1880). Off in every overlay until a live run proves the local gate converges. */
export const goldenPathSigninAfterPortalFlag =
  "golden-path-signin-after-portal";

/**
 * Whether the golden-path sign-in waits for the portal: its Services need the platform Keycloak, which starts only after the Argo CD delivery while the staged install is on (ADR 0113, issue 1880). With any of the three flags off the Applications are gated with the rest of the delivery, as before.
 */
export function signinAwaitsPortal(
  environment: Pick<Environment, "features">,
): boolean {
  return (
    featureEnabled(environment, goldenPathSigninFlag) &&
    featureEnabled(environment, portalStagedInstallFlag) &&
    featureEnabled(environment, goldenPathSigninAfterPortalFlag)
  );
}

/** The flag that stages the portal install: a release that declares startsAfterDelivery starts only after the Argo CD delivery is Synced and Healthy (ADR 0113, issue 1318). */
export const portalStagedInstallFlag = "portal-staged-install";

/** Whether a component starts after the Argo CD delivery: it declares so, and the staged install is on. */
export function startsAfterDelivery(
  environment: Pick<Environment, "features">,
  component: Pick<Component, "startsAfterDelivery">,
): boolean {
  return (
    component.startsAfterDelivery === true &&
    featureEnabled(environment, portalStagedInstallFlag)
  );
}

/** The flag that adds the shared Gateway's wildcard listener, and so lets the golden-path and portal charts attach routes to it beside their own Gateways (ADR 0132, ADR 0133). */
export const platformSharedGatewayFlag = "platform-shared-gateway";

/** The flag that renders the kore-template-images policy, which admits the golden-path template images by signature under the release identity (plan 15 Step 4, issue 1884), and labels the golden-path namespaces its creators make (the golden-path sync and the Service composition) for policy.sigstore.dev/include (ADR 0181). The policy admits only the template repository; off in every overlay until a recorded live outcome. */
export const goldenPathTemplateAdmissionFlag = "golden-path-template-admission";

/** The flag that routes databases by name through the shared Gateway's passthrough listener, and gives each database its certificate from the local CA (ADR 0136, ADR 0137). */
export const databaseRoutesFlag = "database-routes";

/** The flag that routes OTLP by name through the shared Gateway to the standard collector receiver on 4318 (ADR 0140, issue 1224). */
export const otlpRouteFlag = "otlp-route";

/** The flag that turns on the golden-path sign-in flow in the Kotlin BFF template: an OIDC sign-in behind a server-side session, off in every overlay until a live run proves it (plan 15 Step 7, issue 1745). */
export const goldenPathSigninFlag = "golden-path-signin";
