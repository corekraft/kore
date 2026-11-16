// The writer price table (#868, parent #825): the published model prices, pinned with
// the date they were read from https://platform.claude.com/docs/en/about-claude/pricing.
// The ledger's token.usage sums input, output and cache-creation tokens, so a cost is
// weighted rather than priced in dollars: each model's input price relative to the
// baseline. Every model here has the same output-to-input ratio, so the tier ratios
// hold for any token mix.

export const PRICES_AS_OF = "2026-11-16";

/** The model whose input price is the weight 1. */
export const PRICE_BASELINE = "claude-haiku-5-5";

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** USD per million tokens, as published on PRICES_AS_OF. */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-fable-5-2": { inputPerMTok: 8, outputPerMTok: 40 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
};

/** A model's weight: its input price over the baseline's; undefined for a model the table does not price. */
export function priceWeight(model: string): number | undefined {
  const price = Object.hasOwn(MODEL_PRICES, model)
    ? MODEL_PRICES[model]
    : undefined;
  const base = MODEL_PRICES[PRICE_BASELINE];
  if (price === undefined || base === undefined) {
    return undefined;
  }
  return price.inputPerMTok / base.inputPerMTok;
}
