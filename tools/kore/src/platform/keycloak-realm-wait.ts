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

/** Consecutive clean reads of a settled rollout and an answering realm before the portal is applied. */
export const SETTLED_READS = 3;

interface StatefulSetState {
  metadata?: { generation?: number };
  spec?: { replicas?: number };
  status?: {
    observedGeneration?: number;
    replicas?: number;
    readyReplicas?: number;
    updatedReplicas?: number;
    currentRevision?: string;
    updateRevision?: string;
  };
}

interface KeycloakState {
  status?: { conditions?: { type?: string; status?: string }[] };
}

function parse<T>(stdout: string, what: string): T {
  try {
    const parsed: T = JSON.parse(stdout);
    return parsed;
  } catch {
    throw new Error(`kubectl returned unreadable JSON for ${what}`);
  }
}

/**
 * Why the StatefulSet the Keycloak operator runs is still rolling, or
 * undefined when it has settled: its controller has seen the latest spec,
 * every replica is updated and ready, and the current revision is the update
 * revision. The operator rolls it again after the Keycloak release returns, so
 * an old pod can answer while its replacement is not yet ready (issue 2037).
 */
function statefulSetRolling(state: StatefulSetState): string | undefined {
  const replicas = state.spec?.replicas ?? 1;
  const status = state.status ?? {};
  const updated = status.updatedReplicas ?? 0;
  const ready = status.readyReplicas ?? 0;
  if ((status.observedGeneration ?? 0) < (state.metadata?.generation ?? 0)) {
    return "the keycloak StatefulSet has not yet observed its latest spec";
  }
  const counts = [updated, ready, status.replicas ?? 0];
  if (
    counts.some((count) => count !== replicas) ||
    status.currentRevision !== status.updateRevision
  ) {
    return `the keycloak StatefulSet is still rolling out: ${updated} updated and ${ready} ready of ${replicas} replicas, revision ${status.currentRevision ?? "none"} to ${status.updateRevision ?? "none"}`;
  }
  return undefined;
}

/** Why the Keycloak resource is not Ready, or undefined when it is and is not rolling an update. */
function keycloakNotReady(state: KeycloakState): string | undefined {
  const conditions = state.status?.conditions ?? [];
  const isTrue = (type: string): boolean =>
    conditions.some((c) => c.type === type && c.status === "True");
  if (!isTrue("Ready")) {
    return "the Keycloak resource is not Ready yet";
  }
  if (isTrue("RollingUpdate")) {
    return "the Keycloak resource reports RollingUpdate";
  }
  return undefined;
}

/** One read of the rollout and the realm: why it is not settled, or undefined. */
async function readNotSettled(
  read: (args: string[]) => Promise<string>,
): Promise<string | undefined> {
  const namespaced = ["--namespace", NAMESPACE, "get"];
  const rolling = statefulSetRolling(
    parse<StatefulSetState>(
      await read([
        ...namespaced,
        "statefulset",
        "keycloak",
        "--output",
        "json",
      ]),
      "the keycloak StatefulSet",
    ),
  );
  if (rolling !== undefined) {
    return rolling;
  }
  const notReady = keycloakNotReady(
    parse<KeycloakState>(
      await read([...namespaced, "keycloak", "keycloak", "--output", "json"]),
      "the Keycloak resource",
    ),
  );
  if (notReady !== undefined) {
    return notReady;
  }
  return (await read(["get", "--raw", DISCOVERY_PATH])).includes('"issuer"')
    ? undefined
    : "the discovery reply carried no issuer";
}

/**
 * Waits for the Keycloak rollout to settle and the realm the portal signs in
 * against to answer OIDC discovery, before the portal's release is applied
 * (issues 1984 and 2037). The Keycloak release's own readiness is the
 * StatefulSet's rollout, which the Keycloak operator can roll again after
 * kore's check passes, so on an upgrade the portal's proxy started while
 * Keycloak had no endpoint, exited on discovery's 503 and sat in a restart
 * back-off kore's fail-fast then reported as a crash loop. One answer is not
 * enough while the old pod still serves, so the StatefulSet and the Keycloak
 * resource must report the rollout done and discovery must answer on
 * SETTLED_READS reads in a row; any miss starts the count again. Waiting here
 * fails with the cause named, in minutes, instead of as an unnamed rollout
 * timeout. Read-only; a no-op with platform-keycloak-realm-wait off, so the
 * flag off runs what it ran before.
 */
export async function waitForKeycloakRealm(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  if (!featureEnabled(repository.environment, keycloakRealmWaitFlag)) {
    return;
  }
  const context = repository.environment.kubeContext;
  const read = async (args: string[]): Promise<string> =>
    (
      await runner.run("kubectl", ["--context", context, ...args], {
        capture: true,
      })
    ).stdout;
  const notSettled = (): Promise<string | undefined> => readNotSettled(read);
  let clean = 0;
  try {
    await pollUntil(BOUND, async () => {
      let reason: string | undefined;
      try {
        reason = await notSettled();
      } catch (error) {
        // Only the restart signatures wait; Forbidden or an unreachable
        // context cannot clear by waiting and fails at once.
        if (!RESTARTING.test(errorMessage(error))) {
          throw error;
        }
        reason = errorMessage(error);
      }
      clean = reason === undefined ? clean + 1 : 0;
      return (
        reason ??
        (clean < SETTLED_READS
          ? `${clean} of ${SETTLED_READS} consecutive clean reads`
          : undefined)
      );
    });
  } catch (error) {
    if (!(error instanceof ReadinessTimeout)) {
      throw error;
    }
    throw new Error(
      `the Keycloak rollout did not settle and the realm platform did not answer OIDC discovery ${SETTLED_READS} times in a row within ${BOUND}: ${error.message}. The portal's sign-in proxy exits when discovery fails and Kubernetes backs its restart off, so the portal was not rolled out. Check kubectl --context ${context} --namespace ${NAMESPACE} get pods and kubectl --context ${context} --namespace ${NAMESPACE} get statefulset,keycloak, then the keycloak-0 logs.`,
    );
  }
}
