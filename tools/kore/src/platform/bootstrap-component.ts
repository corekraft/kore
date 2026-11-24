// oxlint-disable import/max-dependencies -- bootstrapping one component orders every prerequisite step before its release, and each step is its own module
import type { Component, Repository } from "../config/index.js";
import {
  applyChartCredential,
  ensureRegistryAuth,
  ensureRegistryTrust,
} from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import { waitForApiserverReady } from "./apiserver-ready.js";
import { enrollSharedGatewayRoute } from "./enrollment.js";
import { waitForGatekeeperAdmission } from "./gatekeeper-admission.js";
import {
  ensureKeycloakProviderCredentials,
  ensurePortalSecrets,
} from "./portal-secrets.js";
import { assertMetricsServerUnowned } from "./metrics-server-ownership.js";
import { reconcileIfNeeded } from "./reconcile.js";

/**
 * The controllers and CNI components whose rollouts crash when the API server
 * is not answering yet: they dial it at start and exit, then sit in a restart
 * back-off that kore's rollout wait reports as a crash loop or a timeout
 * (issue 2011).
 */
const NEEDS_APISERVER: ReadonlySet<string> = new Set([
  "keycloak-operator",
  "agentgateway",
  "istio-cni",
  "ztunnel",
]);

/**
 * Reconciles one bootstrap component with the secrets and trust that must
 * surround it. `afterGatekeeper` is true once Gatekeeper is installed: its
 * admission webhook fails closed and has no endpoints right after a cluster
 * restart, so it must answer before a later component creates a namespace or
 * any other admitted object (#787).
 */
export async function bootstrapComponent(
  repository: Repository,
  runner: Runner,
  component: Component,
  afterGatekeeper: boolean,
): Promise<void> {
  if (afterGatekeeper) {
    await waitForGatekeeperAdmission(repository, runner);
  }
  // The registry proxy mounts these Secrets, so they precede its release
  // (ADR 0034). Existing credentials are reused, never rotated.
  if (component.name === "oci-registry") {
    await ensureRegistryAuth(repository, runner);
  }
  // An existing cluster may still run k3s's bundled metrics-server, which
  // owns the ClusterRole the release must own; fail before Helm does.
  if (component.name === "metrics-server") {
    await assertMetricsServerUnowned(repository, runner);
  }
  // The controllers and CNI components crash when the API server is not
  // answering yet, so their rollouts follow one readiness step (issue 2011).
  // A no-op with platform-apiserver-ready off.
  if (NEEDS_APISERVER.has(component.name)) {
    await waitForApiserverReady(repository, runner, component);
  }
  // A route-bearing component's namespace carries the shared Gateway label
  // before its release is applied and waited on (#1388).
  await enrollSharedGatewayRoute(repository, runner, component);
  await reconcileIfNeeded(repository, runner, component);
  // Argo CD is installed, so it gets the registry's read identity before
  // kore-config-delivery creates the Applications that pull charts with it
  // (ADR 0034). A no-op unless `platform up` composed the delivery values.
  if (component.name === "argocd") {
    await applyChartCredential(repository, runner);
  }
  // The operator's chart creates the keycloak namespace, so the Secrets the
  // platform Keycloak and Backstage read (the bootstrap admin, the sign-in
  // secrets) are streamed in right after it (ADR 0034). Present only with
  // platform-portal on.
  if (component.name === "keycloak-operator") {
    await ensurePortalSecrets(repository, runner);
  }
  // The provider's ClusterProviderConfig reads this credential, built from
  // the admin Secret above, so it follows the provider's install (ADR 0034).
  if (component.name === "keycloak-provider") {
    await ensureKeycloakProviderCredentials(repository, runner);
  }
  // The CA exists once the registry's certificate is issued. Clients that
  // live in the cluster (the node's containerd, Policy Controller) get it
  // before anything that depends on the registry runs (ADR 0058), and it is
  // reapplied unchanged on every run, so an existing profile migrates from
  // HTTP to HTTPS with no manual step.
  if (component.name === "oci-registry") {
    await ensureRegistryTrust(repository, runner);
  }
}
