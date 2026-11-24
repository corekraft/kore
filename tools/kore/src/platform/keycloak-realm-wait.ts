import { featureEnabled, keycloakRealmWaitFlag } from "../config/index.js";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { errorMessage } from "./probe.js";
import { ReadinessTimeout, pollUntil } from "./readiness-poll.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

const NAMESPACE = "keycloak";
const BOUND = "5m";
/**
 * The realm's discovery document, read through the API server's Service proxy
 * to the operator's HTTP Service (keycloak-service on 8080), so it needs no
 * Gateway, DNS, certificate or exec into the Keycloak pod.
 */
const DISCOVERY_PATH = `/api/v1/namespaces/${NAMESPACE}/services/keycloak-service:8080/proxy/realms/platform/.well-known/openid-configuration`;
/** What the API server reports while Keycloak has no ready endpoint or is mid-restart. */
const RESTARTING =
  /ServiceUnavailable|no endpoints available|connection refused|\(503\)|\(502\)|BadGateway|Timeout|timed out/i;

/**
 * Waits for the Keycloak realm the portal signs in against to answer OIDC
 * discovery, before the portal's release is applied (issue 1984). The Keycloak
 * release's own readiness is the StatefulSet's rollout, which the Keycloak
 * operator can roll again after kore's check passes, so on an upgrade the
 * portal's proxy started while Keycloak had no endpoint, exited on discovery's
 * 503 and sat in a restart back-off kore's fail-fast then reported as a
 * crash loop. Waiting here fails with the cause named, in minutes, instead of
 * as an unnamed rollout timeout. Read-only; a no-op with platform-keycloak-realm-wait
 * off, so the flag off runs what it ran before.
 */
export async function waitForKeycloakRealm(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  if (!featureEnabled(repository.environment, keycloakRealmWaitFlag)) {
    return;
  }
  const context = repository.environment.kubeContext;
  try {
    await pollUntil(BOUND, async () => {
      try {
        const { stdout } = await runner.run(
          "kubectl",
          ["--context", context, "get", "--raw", DISCOVERY_PATH],
          { capture: true },
        );
        return stdout.includes('"issuer"')
          ? undefined
          : "the discovery reply carried no issuer";
      } catch (error) {
        // Only the restart signatures wait; Forbidden or an unreachable
        // context cannot clear by waiting and fails at once.
        if (RESTARTING.test(errorMessage(error))) {
          return errorMessage(error);
        }
        throw error;
      }
    });
  } catch (error) {
    if (!(error instanceof ReadinessTimeout)) {
      throw error;
    }
    throw new Error(
      `the Keycloak realm platform did not answer OIDC discovery within ${BOUND}: ${error.message}. The portal's sign-in proxy exits when discovery fails and Kubernetes backs its restart off, so the portal was not rolled out. Check kubectl --context ${context} --namespace ${NAMESPACE} get pods and the keycloak-0 logs.`,
    );
  }
}
