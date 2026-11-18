// Plan-weighted tokens of a model's token.split counts (#1039, spec #1030): every token kind
// of each prompt step, weighted by one model weight per step. A step's weight is the model's
// input price over the baseline's input price, read from its over-step rates on the high step
// where the model has one (Haiku: 0.5 / 0.1 = 5). The weights approximate the plan's own
// weighting, which the harness cannot read; writer-cost.ts still weights input alone.

import type { SplitOrigin } from "../ledger/index.js";
import { MODEL_PRICES, PRICE_BASELINE, type Rates } from "./writer-prices.js";

/** One model's counts from a token.split reading: each prompt step's five token kinds. */
export type PlanTokenCounts = Pick<
  SplitOrigin,
  | "model"
  | "lowInput"
  | "lowCacheWrite5m"
  | "lowCacheWrite1h"
  | "lowCacheRead"
  | "lowOutput"
  | "highInput"
  | "highCacheWrite5m"
  | "highCacheWrite1h"
  | "highCacheRead"
  | "highOutput"
>;

/** The input-price weight of a step's rates over the baseline model's input price. */
function stepWeight(model: string, step: "low" | "high"): number | undefined {
  const price = Object.hasOwn(MODEL_PRICES, model)
    ? MODEL_PRICES[model]
    : undefined;
  const base = MODEL_PRICES[PRICE_BASELINE];
  if (price === undefined || base === undefined) {
    return undefined;
  }
  const rates: Rates =
    step === "high" && price.overStep !== undefined ? price.overStep : price;
  return rates.inputPerMTok / base.inputPerMTok;
}

/**
 * A model's tokens, each prompt step's five kinds summed and weighted by that step's weight,
 * or undefined for a model the price table does not price (never zero for an unpriced one).
 */
export function planWeightedTokens(
  counts: PlanTokenCounts,
): number | undefined {
  const lowWeight = stepWeight(counts.model, "low");
  const highWeight = stepWeight(counts.model, "high");
  if (lowWeight === undefined || highWeight === undefined) {
    return undefined;
  }
  const low =
    counts.lowInput +
    counts.lowCacheWrite5m +
    counts.lowCacheWrite1h +
    counts.lowCacheRead +
    counts.lowOutput;
  const high =
    counts.highInput +
    counts.highCacheWrite5m +
    counts.highCacheWrite1h +
    counts.highCacheRead +
    counts.highOutput;
  return low * lowWeight + high * highWeight;
}
