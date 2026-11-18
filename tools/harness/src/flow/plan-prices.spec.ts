import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { planWeightedTokens, type PlanTokenCounts } from "./plan-tokens.js";
import { planPricesOf } from "./plan-prices.js";

// Everything outside the unit is mocked: the plan weights are a fixed fake, so the table below
// moves only with how planPricesOf reads them. The assumed main-session model is a constant.
vi.mock("./plan-tokens.js", () => ({ planWeightedTokens: vi.fn() }));

const WEIGHTS: Record<string, { low: number; high: number }> = {
  "model-a": { low: 1, high: 2 },
  "claude-opus-5-5": { low: 4, high: 8 },
};

beforeEach(() => {
  vi.mocked(planWeightedTokens).mockImplementation((c: PlanTokenCounts) => {
    const weights = WEIGHTS[c.model];
    return weights === undefined
      ? undefined
      : c.lowInput * weights.low + c.highInput * weights.high;
  });
});

const split = (model: string) =>
  ({ kind: "token.split", model }) as unknown as LedgerEvent;

describe("plan prices: a price table whose dollars are plan-weighted tokens", () => {
  it("prices every token kind of a model at its step weights, one dollar per weighted token", () => {
    const table = planPricesOf([split("model-a")]);

    expect(table["model-a"]).toEqual({
      inputPerMTok: 1_000_000,
      cacheWrite5mPerMTok: 1_000_000,
      cacheWrite1hPerMTok: 1_000_000,
      cacheReadPerMTok: 1_000_000,
      outputPerMTok: 1_000_000,
      overStep: {
        inputPerMTok: 2_000_000,
        cacheWrite5mPerMTok: 2_000_000,
        cacheWrite1hPerMTok: 2_000_000,
        cacheReadPerMTok: 2_000_000,
        outputPerMTok: 2_000_000,
      },
    });
  });

  it("leaves a model the plan weights do not read out of the table, so it is named unpriced and never zero", () => {
    const table = planPricesOf([split("model-a"), split("mystery-model")]);

    expect(Object.keys(table).sort()).toEqual(["claude-opus-5-5", "model-a"]);
  });

  it("always weights the assumed main-session model, whose unread tokens are priced at it", () => {
    const table = planPricesOf([]);

    expect(Object.keys(table)).toEqual(["claude-opus-5-5"]);
    expect(table["claude-opus-5-5"]?.inputPerMTok).toBe(4_000_000);
  });
});
