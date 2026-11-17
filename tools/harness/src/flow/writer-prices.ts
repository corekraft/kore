// The writer price table (#868, parent #825; cache and long-prompt prices #1001, spec #997):
// the published model prices, pinned with the date they were read from
// https://platform.claude.com/docs/en/about-claude/pricing. The ledger's token.split
// reading counts each model's input, cache-write (5 minute and 1 hour), cache-read and
// output tokens per prompt step, so a cost is priced from these rates per request. The
// writer cost in the flow report still weights tokens by the input price alone (priceWeight).

export const PRICES_AS_OF = "2026-11-17";

/** The model whose input price is the weight 1. */
export const PRICE_BASELINE = "claude-haiku-5-5";

/**
 * A request whose prompt is over this many tokens pays a model's `overStep` prices, on
 * the whole request, cache hits included. Only Haiku has a step.
 */
export const PROMPT_STEP_TOKENS = 100_000;

/** The prompt steps a request's prompt length falls in. */
export type PromptStep = "low" | "high";

/** The step a prompt's length falls in: at or under PROMPT_STEP_TOKENS is low, over it high. */
export function promptStepOf(promptTokens: number): PromptStep {
  return promptTokens > PROMPT_STEP_TOKENS ? "high" : "low";
}

/** USD per million tokens for one prompt step. */
export interface Rates {
  inputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  cacheReadPerMTok: number;
  outputPerMTok: number;
}

export interface ModelPrice extends Rates {
  /** The rates for a request over PROMPT_STEP_TOKENS; absent where the model has one price. */
  overStep?: Rates;
}

/**
 * USD per million tokens, as published on PRICES_AS_OF. Output is five times input for
 * every model; cache reads and writes are not, so a tier's cost depends on its token mix.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-fable-5-2": {
    inputPerMTok: 8,
    cacheWrite5mPerMTok: 10,
    cacheWrite1hPerMTok: 16,
    cacheReadPerMTok: 0.2,
    outputPerMTok: 40,
  },
  "claude-opus-5-5": {
    inputPerMTok: 4,
    cacheWrite5mPerMTok: 5,
    cacheWrite1hPerMTok: 8,
    cacheReadPerMTok: 0.2,
    outputPerMTok: 20,
  },
  "claude-sonnet-5-5": {
    inputPerMTok: 2,
    cacheWrite5mPerMTok: 2.5,
    cacheWrite1hPerMTok: 4,
    cacheReadPerMTok: 0.1,
    outputPerMTok: 10,
  },
  "claude-haiku-5-5": {
    inputPerMTok: 0.1,
    cacheWrite5mPerMTok: 0.125,
    cacheWrite1hPerMTok: 0.2,
    cacheReadPerMTok: 0.01,
    outputPerMTok: 0.5,
    overStep: {
      inputPerMTok: 0.5,
      cacheWrite5mPerMTok: 0.625,
      cacheWrite1hPerMTok: 1,
      cacheReadPerMTok: 0.05,
      outputPerMTok: 2.5,
    },
  },
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
