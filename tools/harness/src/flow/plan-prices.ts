// A price table whose dollars are plan-weighted tokens (#1048, spec #1030): each model's five
// kinds are priced at its plan weight per step, one dollar per weighted token, so any figure the
// writer cost reading prices with it reads weighted tokens. The weights come from plan-tokens.ts;
// no second table of weights exists. A model the plan weights do not read is left out of the
// table, so a figure that spans it names it and is never read as zero.

import type { LedgerEvent } from "../ledger/index.js";
import { planWeightedTokens } from "./plan-tokens.js";
import type { ModelPrice, Rates } from "./writer-prices.js";
import type { PriceTable } from "./writer-dollars.js";
import { MAIN_SESSION_MODEL } from "./writer-usage.js";

const MILLION = 1_000_000;

/** The weight of one step: the weighted tokens of a million input tokens, over a million. */
function stepWeight(model: string, step: "low" | "high"): number | undefined {
  const counts = {
    model,
    lowInput: step === "low" ? MILLION : 0,
    lowCacheWrite5m: 0,
    lowCacheWrite1h: 0,
    lowCacheRead: 0,
    lowOutput: 0,
    highInput: step === "high" ? MILLION : 0,
    highCacheWrite5m: 0,
    highCacheWrite1h: 0,
    highCacheRead: 0,
    highOutput: 0,
  };
  const weighted = planWeightedTokens(counts);
  return weighted === undefined ? undefined : weighted / MILLION;
}

/** Rates that price every token kind at one weight per token. */
const ratesAt = (weight: number): Rates => ({
  inputPerMTok: weight * MILLION,
  cacheWrite5mPerMTok: weight * MILLION,
  cacheWrite1hPerMTok: weight * MILLION,
  cacheReadPerMTok: weight * MILLION,
  outputPerMTok: weight * MILLION,
});

/**
 * The plan-weighted table for the models the events read, and the assumed main-session model
 * (whose tokens with no reading are priced at it). Dollars priced with it are weighted tokens.
 */
export function planPricesOf(events: LedgerEvent[]): PriceTable {
  const models = new Set([
    MAIN_SESSION_MODEL,
    ...events
      .filter((e) => e.kind === "token.split" && e.model !== undefined)
      .map((e) => e.model as string),
  ]);
  const table: Record<string, ModelPrice> = {};
  for (const model of models) {
    const low = stepWeight(model, "low");
    const high = stepWeight(model, "high");
    if (low !== undefined && high !== undefined) {
      table[model] = { ...ratesAt(low), overStep: ratesAt(high) };
    }
  }
  return table;
}
