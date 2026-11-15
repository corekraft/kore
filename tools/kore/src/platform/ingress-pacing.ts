// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
//
// The pacing arithmetic of the ingress measurement: an optional target request
// rate makes the load open-loop (fixed batches on a schedule) instead of
// closed-loop, so two runs offer the same rate and their CPU is comparable.

/** The environment variable that sets the target rate for the live run. */
export const targetRateVariable = "KORE_INGRESS_TARGET_RPS";

/** The achieved rate must be within this percent of the target to be matched. */
export const rateTolerancePercent = 10;

export interface RateCheck {
  targetRequestsPerSecond: number;
  achievedRequestsPerSecond: number;
  tolerancePercent: number;
  /** `rate_mismatch` results are not usable as a matched comparison. */
  status: "matched" | "rate_mismatch";
}

const round = (value: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** Unset or empty is the unpaced load; anything else must be a positive number. */
export function parseTargetRate(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${targetRateVariable} must be a positive number of requests per second, got '${raw}'; unset it for the unpaced load`,
    );
  }
  return value;
}

/** One batch is about a second of the target rate; a batch is whole requests. */
export function pacingPlan(
  targetRequestsPerSecond: number,
  requestsPerRoute: number,
): { batchSize: number; batchSeconds: number } {
  const batchSize = Math.max(
    1,
    Math.min(requestsPerRoute, Math.round(targetRequestsPerSecond)),
  );
  return { batchSize, batchSeconds: batchSize / targetRequestsPerSecond };
}

export function matchRate(target: number, achieved: number): RateCheck {
  const within =
    Math.abs(achieved - target) <= (target * rateTolerancePercent) / 100;
  return {
    targetRequestsPerSecond: target,
    achievedRequestsPerSecond: achieved,
    tolerancePercent: rateTolerancePercent,
    status: within ? "matched" : "rate_mismatch",
  };
}

/**
 * Median millicores per request per second, for each column; a column is left
 * out when nothing completed.
 */
export function cpuPerRequest(
  millicores: { ingress: number; ztunnel: number },
  achievedRequestsPerSecond: number,
): { ingress?: number; ztunnel?: number } {
  if (achievedRequestsPerSecond <= 0) {
    return {};
  }
  return {
    ingress: round(millicores.ingress / achievedRequestsPerSecond, 3),
    ztunnel: round(millicores.ztunnel / achievedRequestsPerSecond, 3),
  };
}
