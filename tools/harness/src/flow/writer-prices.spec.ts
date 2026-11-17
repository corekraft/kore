import { describe, expect, it } from "vitest";
import {
  MODEL_PRICES,
  PRICES_AS_OF,
  PRICE_BASELINE,
  PROMPT_STEP_TOKENS,
  priceWeight,
  promptStepOf,
} from "./writer-prices.js";

describe("writer price table", () => {
  it("pins each model's published input, cache and output prices per million tokens, with the date it was read", () => {
    expect(PRICES_AS_OF).toBe("2026-11-17");
    expect(MODEL_PRICES).toEqual({
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
    });
  });

  it("prices Haiku's prompts over 100,000 tokens higher, and no other model has that step", () => {
    expect(PROMPT_STEP_TOKENS).toBe(100_000);
    expect(MODEL_PRICES["claude-haiku-5-5"]?.overStep?.inputPerMTok).toBe(0.5);
    expect(MODEL_PRICES["claude-sonnet-5-5"]).not.toHaveProperty("overStep");
    expect(MODEL_PRICES["claude-opus-5-5"]).not.toHaveProperty("overStep");
    expect(MODEL_PRICES["claude-fable-5-2"]).not.toHaveProperty("overStep");
  });

  it("puts a prompt of exactly 100,000 tokens in the low step and 100,001 in the high step", () => {
    expect(promptStepOf(100_000)).toBe("low");
    expect(promptStepOf(100_001)).toBe("high");
    expect(promptStepOf(0)).toBe("low");
  });

  it("weights a model by its input price relative to the baseline model", () => {
    expect(PRICE_BASELINE).toBe("claude-haiku-5-5");
    expect(priceWeight("claude-haiku-5-5")).toBeCloseTo(1, 10);
    expect(priceWeight("claude-sonnet-5-5")).toBeCloseTo(20, 10);
    expect(priceWeight("claude-opus-5-5")).toBeCloseTo(40, 10);
  });

  it("gives no weight to a model the table does not price, rather than a zero", () => {
    expect(priceWeight("claude-mystery-1")).toBeUndefined();
  });
});
