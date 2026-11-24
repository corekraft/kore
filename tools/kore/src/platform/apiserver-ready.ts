import {
  apiserverReadyFlag,
  featureEnabled,
  type Component,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { errorMessage } from "./probe.js";
import { ReadinessTimeout, pollUntil } from "./readiness-poll.js";

const BOUND = "3m";
const READYZ = "/readyz";
/** What kubectl reports while a restarted API server is not serving yet. */
const STARTING =
  /connection to the server [^\n]*was refused|connection refused|Unable to connect to the server|EOF|TLS handshake timeout|ServiceUnavailable|\(503\)|i\/o timeout|timed out|Client\.Timeout/i;

/**
 * Waits for the API server to answer `/readyz` through the environment's
 * configured context, before the rollout of the component the caller names
 * (issue 2011). On an existing cluster `kore local up` can run while the k3d
 * API server still refuses connections, so the Keycloak operator, the
 * agentgateway controller, istio-cni and ztunnel started, could not reach it
 * and crash-looped. One readiness step shared by those rollouts fails with the
 * cause named, in minutes, instead of a bare CrashLoopBackOff or a rollout
 * timeout. Read-only; a no-op with platform-apiserver-ready off, so the flag off runs what it ran before.
 */
export async function waitForApiserverReady(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<void> {
  if (!featureEnabled(repository.environment, apiserverReadyFlag)) {
    return;
  }
  const context = repository.environment.kubeContext;
  try {
    await pollUntil(BOUND, async () => {
      try {
        const { stdout } = await runner.run(
          "kubectl",
          ["--context", context, "get", "--raw", READYZ],
          { capture: true },
        );
        return stdout.trim() === "ok"
          ? undefined
          : `/readyz replied: ${stdout.trim()}`;
      } catch (error) {
        // Only the starting signatures wait; an unknown context or a
        // Forbidden cannot clear by waiting and fails at once.
        if (STARTING.test(errorMessage(error))) {
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
      `the Kubernetes API server of ${context} was not ready within ${BOUND}, so the ${component.name} rollout was not started: ${error.message}. The controllers crash when they cannot reach it. Run kubectl --context ${context} get --raw /readyz and check the k3s server container (docker logs ${context}-server-0), then rerun kore local up.`,
    );
  }
}
