import { describe, expect, it } from "vitest";
import {
  MODEL_PRICES,
  PRICES_AS_OF,
  PRICE_BASELINE,
  priceWeight,
} from "./writer-prices.js";

describe("writer price table", () => {
  it("pins each model's published input and output price per million tokens, with the date it was read", () => {
    expect(PRICES_AS_OF).toBe("2026-11-16");
    expect(MODEL_PRICES).toEqual({
      "claude-fable-5-2": { inputPerMTok: 8, outputPerMTok: 40 },
      "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
      "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
      "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
    });
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
