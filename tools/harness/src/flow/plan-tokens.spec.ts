import { describe, expect, it } from "vitest";
import { planWeightedTokens } from "./plan-tokens.js";

interface Kinds {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

const ZERO: Kinds = {
  input: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  output: 0,
};

/** A token.split reading's counts for one model, written with each prompt step's kinds. */
const split = (model: string, low: Kinds, high: Kinds = ZERO) => ({
  model,
  lowInput: low.input,
  lowCacheWrite5m: low.cacheWrite5m,
  lowCacheWrite1h: low.cacheWrite1h,
  lowCacheRead: low.cacheRead,
  lowOutput: low.output,
  highInput: high.input,
  highCacheWrite5m: high.cacheWrite5m,
  highCacheWrite1h: high.cacheWrite1h,
  highCacheRead: high.cacheRead,
  highOutput: high.output,
});

describe("plan-weighted tokens", () => {
  it("weights every token kind of a Sonnet request by Sonnet's input-price weight of 20, at both steps", () => {
    const sonnet = split(
      "claude-sonnet-5-5",
      {
        input: 1000,
        cacheWrite5m: 100,
        cacheWrite1h: 10,
        cacheRead: 500,
        output: 40,
      },
      { input: 100, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
    );
    // (1650 low + 100 high) tokens, each at weight 20.
    expect(planWeightedTokens(sonnet)).toBe(35000);
  });

  it("weights Haiku's low-step tokens at 1 and its high-step tokens at the step's price, 5", () => {
    const haiku = split(
      "claude-haiku-5-5",
      {
        input: 1000,
        cacheWrite5m: 100,
        cacheWrite1h: 10,
        cacheRead: 500,
        output: 40,
      },
      {
        input: 600,
        cacheWrite5m: 100,
        cacheWrite1h: 0,
        cacheRead: 300,
        output: 0,
      },
    );
    // 1650 low tokens at weight 1, plus 1000 high tokens at weight 0.5 / 0.1 = 5.
    expect(planWeightedTokens(haiku)).toBe(6650);
  });

  it("returns undefined for a model the price table does not price, never zero", () => {
    const mystery = split("claude-mystery-1", {
      input: 1000,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
      output: 0,
    });
    expect(planWeightedTokens(mystery)).toBeUndefined();
  });

  it("counts a model with no tokens at zero, not as unpriced", () => {
    expect(planWeightedTokens(split("claude-opus-5-5", ZERO))).toBe(0);
  });
});
