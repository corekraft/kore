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

/**
 * Whether a component's value file is left out of its Helm arguments because the
 * flag that gates it is off: a component's valuesFlags names the flag per file, so a
 * file that carries only a flag's numbers is not passed to Helm while the flag is off (issue 1593).
 */
export function valuesGatedOff(
  environment: Pick<Environment, "features">,
  component: { valuesFlags?: Record<string, string> | undefined },
  path: string,
): boolean {
  const flag = component.valuesFlags?.[path];
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

/** The flag that makes a registry prune spare the digests a revert needs (ADR 0153); off, the prune is as before. */
export const revertKeepFlag = "registry-revert-keep";

/** The flag that installs metrics-server and turns on autoscaling defaults (ADR 0047). */
export const autoscalingFlag = "autoscaling-defaults";

/** The app sizing flag (#1525): the record's worst-case judge at kore validate; off, validation is unchanged. */
export const appSizingFlag = "app-sizing";

/** The flag that creates each suborg's namespace, labels, ResourceQuota and LimitRange from the Organization composition, and stops the Service composition creating a namespace per environment (ADR 0165, issue 1550). Needs the Organization API, the records Application and the portal, which together make the Organization the one namespace owner. Off in every overlay until a recorded live outcome. */
export const suborgTenancyFlag = "suborg-tenancy";

/** The flag that renders the suborg ingress and egress NetworkPolicies and the grant policies (ADR 0165, issue 1552); needs suborg-tenancy. Off in every overlay until a recorded live outcome (#1559). */
export const suborgNetworkPolicyFlag = "suborg-network-policy";

/** The flag that makes each suborg's Argo CD AppProject, which deploys only into the suborg's namespace from the Kore repository (ADR 0165, issue 1553); needs suborg-tenancy and platform-argocd-delivery. Off in every overlay until a recorded live outcome. */
export const suborgDeliveryProjectFlag = "suborg-delivery-project";

/** The flag that installs the Organization and Service platform APIs, for the platform organization only (plan 15 step 2). */
export const organizationServiceApisFlag = "platform-organization-service-apis";

/** The flag that installs the platform organization's Argo CD in the core phase (ADR 0043, plan 15 step 5). */
export const platformArgocdDeliveryFlag = "platform-argocd-delivery";

/** The flag that lets the configuration AppProject carry a maintenance deny window, which a held maintenance run denies every sync with (ADR 0153, issue 1540). Off in every overlay until a live run proves it refuses a sync. */
export const platformSyncWindowFlag = "platform-sync-window";

/** The flag that makes a recovery refuse a helm rollback of a release Argo CD owns, naming its git revert (ADR 0153, issue 1541). Off in every overlay until a recorded live outcome. */
export const releaseRecoveryArgocdRefusalFlag =
  "release-recovery-argocd-refusal";

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

/** The flag that makes the portal's pod wait for the Keycloak realm's OIDC discovery before its proxy starts, so a restart after a stop converges (issue 1788). Off in every overlay until a recorded live run proves the restart converges. */
export const keycloakWaitFlag = "platform-keycloak-wait";

/** The flag that makes kore wait for the Keycloak realm's OIDC discovery before it applies the portal's release, so a Keycloak upgrade converges or fails naming the cause (issue 1984). Off in every overlay until a recorded live run proves an upgrade converges. */
export const keycloakRealmWaitFlag = "platform-keycloak-realm-wait";

/** The flag that makes kore wait for the Kubernetes API server to answer /readyz before it rolls out the Keycloak operator, agentgateway, istio-cni and ztunnel, so a cold-start API server converges or fails naming the cause (issue 2011). Off in every overlay until a recorded live run proves `kore local up` converges over an existing cluster. */
export const apiserverReadyFlag = "platform-apiserver-ready";

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

/** The flag that makes each Gateway admit ListenerSets only from the namespaces the platform labels as shared, so a service's ListenerSet attaches to a platform Gateway (ADR 0159, issue 1633). Needs platform-shared-gateway, which sets the label. Off in every overlay until a recorded live outcome. */
export const serviceListenerSetsFlag = "service-listener-sets";

/** The flag that renders the external Gateway, kore-gateway-external: one HTTP listener on 80 that redirects to HTTPS, and no HTTPS listener until a service claims a name (ADR 0160, issue 1633). Needs service-listener-sets. Off in every overlay until a recorded live outcome. */
export const externalGatewayFlag = "external-gateway";

/** The flag that renders the one platform-owned AgentgatewayPolicy on the external Gateway, which sets its concurrency, rate, 1 MiB body, header and timeout limits with Override inheritance, so no route policy can loosen them (ADR 0160, issue 1674). Needs external-gateway; the numbers are read from the environment's values. Off in every overlay until a recorded live outcome of the public probe (429, 503, 413 and served). */
export const externalGatewayLimitsFlag = "external-gateway-limits";

/** The flag that renders external-dns, which publishes A records for the routes of the external Gateway into the platform domain's one zone (ADR 0162, issue 1616). Needs external-gateway. Off in every overlay until a recorded live outcome; local runs the inmemory provider, vps the Cloudflare one. */
export const externalDnsFlag = "external-dns";

/** The flag that renders the Let's Encrypt staging and production ClusterIssuers, which solve DNS-01 through Cloudflare for the platform domain's one zone, and the cert-manager resolvers that let the challenge record be seen (ADR 0161, issue 1618). vps only, because it needs a real zone; off in the vps overlay until a recorded live outcome. */
export const acmeDns01Flag = "acme-dns01";

/** The flag that adds an HTTP-01 solver to the two issuers acme-dns01 renders, so a name the external Gateway serves is proved through its port 80 listener and needs no DNS token (ADR 0157, issue 1637). Needs acme-dns01, which renders the issuers it adds the solver to, and is needed by external-gateway. vps only; off in the vps overlay until a recorded live outcome. */
export const acmeIssuersFlag = "acme-issuers";

/** The flag that renders the kore-template-images policy, which admits the golden-path template images by signature under the release identity (plan 15 Step 4, issue 1884), and labels the golden-path namespaces its creators make (the golden-path sync and the Service composition) for policy.sigstore.dev/include (ADR 0181). The policy admits only the template repository; off in every overlay until a recorded live outcome. */
export const goldenPathTemplateAdmissionFlag = "golden-path-template-admission";

/** The flag that routes databases by name through the shared Gateway's passthrough listener, and gives each database its certificate from the local CA (ADR 0136, ADR 0137). */
export const databaseRoutesFlag = "database-routes";

/** The flag that derives a PostgreSQL's CloudNativePG instances from its serviceClass (standard 2 with the disruption budget, development 1 without), switchover, and a memory request equal to limit (ADR 0154). Off in every overlay until a recorded live outcome. */
export const postgresqlServiceClassInstancesFlag =
  "postgresql-service-class-instances";

/** The flag that gives the shared gateway proxy the app defaults: two replicas, a RollingUpdate with maxUnavailable 0 and maxSurge 1, a readiness gate (minReadySeconds, progressDeadlineSeconds) and a PodDisruptionBudget (ADR 0154, issue 1529). Off in every overlay until a recorded live outcome. */
export const gatewayProxyDefaultsFlag = "gateway-proxy-defaults";

/** The flag that gives the gateway proxy, platform DNS, the policy controller and the registry Guaranteed QoS: each requests its limit for CPU and memory, so its pods are Guaranteed (ADR 0152, issue 1593). Off in every overlay until a recorded live outcome; the numbers are the environment's values. */
export const dataPathGuaranteedQosFlag = "data-path-guaranteed-qos";

/** The flag that routes OTLP by name through the shared Gateway to the standard collector receiver on 4318 (ADR 0140, issue 1224). */
export const otlpRouteFlag = "otlp-route";

/** The flag that renders the golden-path workload safety defaults: two replicas, an explicit rolling update, a PodDisruptionBudget, separate readiness and liveness endpoints and the termination settings (ADR 0154, issue 1521). Off in every overlay until a recorded live outcome. */
export const goldenPathSafetyDefaultsFlag = "golden-path-safety-defaults";

/** The flag that renders each golden-path service's identity: a Service and a ServiceAccount named after the service, and each Deployment running as that account with its API token not mounted (issue 1551). Off in every overlay until a recorded live outcome. */
export const goldenPathServiceIdentityFlag = "golden-path-service-identity";
export const workloadDefaultsAdmissionFlag = "workload-defaults-admission";

/** The flag that installs the Gatekeeper constraint refusing a PersistentVolumeClaim in an app namespace CloudNativePG does not own, in dryrun, so v1 backup gaps show in an audit before any refusal (ADR 0072, issue 1666). Off in every overlay until a recorded live outcome. */
export const pvcOwnershipAdmissionFlag = "pvc-ownership-admission";

/** The flag that delivers each app's record through the golden-path ApplicationSet: a release file is a values file of its Application and the workload deploys its digest (ADR 0166, ADR 0172, issue 1569). Off in every overlay until a recorded live outcome turns it on. */
export const appDeliveryFlag = "app-delivery";

/** The flag that turns on the golden-path sign-in flow in the Kotlin BFF template: an OIDC sign-in behind a server-side session, off in every overlay until a live run proves it (plan 15 Step 7, issue 1745). */
export const goldenPathSigninFlag = "golden-path-signin";
