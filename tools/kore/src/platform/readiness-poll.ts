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

const KUBECTL_WAIT_TIMED_OUT = /timed out waiting for the condition/i;

/**
 * Runs `attempt` at each bound in turn and returns the last failure's message,
 * or undefined when one passes. It moves to the next, longer bound only when
 * `kubectl wait` timed out, so a missing resource or a failed condition is
 * reported at once while a slow API server on a loaded host gets another try.
 */
export async function failureAcrossBounds(
  bounds: string[],
  attempt: (bound: string) => Promise<void>,
): Promise<string | undefined> {
  let failure: string | undefined;
  for (const bound of bounds) {
    try {
      await attempt(bound);
      return undefined;
    } catch (error) {
      failure = errorMessage(error);
      if (!KUBECTL_WAIT_TIMED_OUT.test(failure)) {
        return failure;
      }
    }
  }
  return failure;
}
