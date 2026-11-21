// Docs: infra/plans/13-agentgateway-ingress.md#golden-path-route-set
//
// The wait before the golden-path scale check. The check refuses a host whose
// 1-minute load average is at or above its guard, and the p95 test just before it
// leaves the host busy for a while, so the live spec waits here for the load to
// fall under the guard instead of refusing straight after. It reads the load and
// sleeps between reads; it sends nothing and writes nothing.

export interface QuietHostOptions {
  maxLoadAverage: number;
  /** Reads of the host load before the wait is given up on. */
  maxPolls: number;
  pollIntervalSeconds: number;
}

export interface QuietHostDeps {
  sleep: (seconds: number) => Promise<void>;
  /** The host's 1-minute load average. */
  loadAverage: () => number;
}

/**
 * Reads the host load until it is below the guard and returns the load it read.
 * A load equal to the guard is busy, as the scale check refuses it. Refuses,
 * naming the load and the guard, once the poll budget is spent.
 */
export async function waitForQuietHost(
  deps: QuietHostDeps,
  { maxLoadAverage, maxPolls, pollIntervalSeconds }: QuietHostOptions,
): Promise<number> {
  for (let poll = 1; ; poll++) {
    const loadAverage = deps.loadAverage();
    if (loadAverage < maxLoadAverage) {
      return loadAverage;
    }
    if (poll >= maxPolls) {
      throw new Error(
        `host 1-minute load average ${loadAverage} did not fall below ${maxLoadAverage} within ${maxPolls * pollIntervalSeconds} seconds; wait for the host to quiet down and rerun`,
      );
    }
    await deps.sleep(pollIntervalSeconds);
  }
}
