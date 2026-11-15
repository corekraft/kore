import type { Judgement } from "./judge.js";

export interface TierGuard {
  /** The send-backs judged as a metric that must not rise. */
  judgement: Judgement;
  before: number | null;
  after: number | null;
}

/**
 * A tier change saves cost only if judge send-backs did not pay for it. A cost
 * that did not fall keeps its own judgement; one that fell is confirmed when
 * send-backs stayed flat or fell, refuted when they rose past the threshold (or
 * from none), and inconclusive without a send-backs figure.
 */
export function judgeTier({
  cost,
  guard,
  guardMetric,
}: {
  cost: Judgement;
  guard: TierGuard;
  guardMetric: string;
}): Judgement {
  if (cost.result !== "confirmed") {
    return cost;
  }
  const { before, after } = guard;
  if (before === null || after === null) {
    return {
      ...cost,
      result: "inconclusive",
      reason: `${cost.reason}, but ${guardMetric} has no figure before and after to judge it against`,
    };
  }
  const rose =
    guard.judgement.result === "refuted" || (before === 0 && after > 0);
  if (rose) {
    return {
      ...cost,
      result: "refuted",
      reason: `${cost.reason}, but ${guardMetric} rose from ${before} to ${after} past the threshold`,
    };
  }
  return {
    ...cost,
    reason: `${cost.reason}; ${guardMetric} stayed within the noise threshold (${before} to ${after})`,
  };
}
