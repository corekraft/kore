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
