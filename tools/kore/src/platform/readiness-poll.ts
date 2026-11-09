import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { errorMessage } from "./probe.js";

const POLL_MILLISECONDS = 250;

/** Errors that mean the resource or its type does not exist yet. */
export const NOT_YET_THERE =
  /not found|no matches for kind|the server doesn't have a resource type/i;

function unitMilliseconds(unit: string | undefined): number {
  if (unit === "h") {
    return 3600000;
  }
  if (unit === "m") {
    return 60000;
  }
  return 1000;
}

export function timeoutMilliseconds(value: string): number {
  const match = value.match(/^(\d+)([smh])$/);
  if (!match) {
    return 10 * 60 * 1000;
  }
  return Number(match[1]) * unitMilliseconds(match[2]);
}

export function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, POLL_MILLISECONDS));
}

/**
 * Polls `probe` until it reports ready (undefined) or the timeout elapses,
 * always probing at least once. A probe returns the reason it is not ready, or
 * throws; only not-yet-there errors are retried, any other error (Forbidden,
 * unreachable context, malformed output) is rethrown at once. The last reason
 * becomes the failure.
 */
export async function pollUntil(
  timeout: string,
  probe: () => Promise<string | undefined>,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds(timeout);
  while (true) {
    let reason: string | undefined;
    try {
      reason = await probe();
    } catch (error) {
      if (!NOT_YET_THERE.test(errorMessage(error))) {
        throw error;
      }
      reason = errorMessage(error);
    }
    if (reason === undefined) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(reason);
    }
    await pause();
  }
}

/** Bound for each read-only check `kore status` evaluates. */
const STATUS_TIMEOUT = "3s";
/** Status-mode `--timeout` for `kubectl wait`/`rollout status`: it spans kubectl's startup, so 3s misreported a long-Established CRD on a loaded host. */
const STATUS_KUBECTL_TIMEOUT = "15s";

/** How a run of checks is bounded and whether it captures kubectl output. */
export interface Bounds {
  timeout: string;
  capture: boolean;
  kubectlTimeout?: string;
}

export const STATUS_BOUNDS: Bounds = {
  timeout: STATUS_TIMEOUT,
  capture: true,
  kubectlTimeout: STATUS_KUBECTL_TIMEOUT,
};

export interface ConditionContext {
  repository: Repository;
  runner: Runner;
  kubectlTimeout?: string | undefined;
}

/**
 * Waits for each condition on a cluster-scoped resource in order, retrying
 * while the resource or its type does not exist yet.
 */
export async function waitForConditions(
  { repository, runner, kubectlTimeout }: ConditionContext,
  resource: string,
  conditions: string[],
  timeout: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds(timeout);
  for (const condition of conditions) {
    while (true) {
      try {
        await runner.run(
          "kubectl",
          [
            "--context",
            repository.environment.kubeContext,
            "wait",
            `--for=condition=${condition}`,
            resource,
            `--timeout=${kubectlTimeout ?? timeout}`,
          ],
          { capture: true },
        );
        break;
      } catch (error) {
        if (
          !NOT_YET_THERE.test(errorMessage(error)) ||
          Date.now() >= deadline
        ) {
          throw error;
        }
        await pause();
      }
    }
  }
}
