import { describe, expect, it } from "vitest";
import type { ModelPrice } from "./writer-prices.js";
import {
  event,
  HAIKU,
  OPTIONS,
  SONNET,
  WINDOW,
  launch,
  linked,
  mergedAt,
} from "./writer-cost-support.js";
import { writerCost } from "./writer-cost.js";

const OPUS = "claude-opus-5-5";
const MILLION = 1_000_000;

const HAIKU_PRICE: ModelPrice = {
  inputPerMTok: 1,
  cacheWrite5mPerMTok: 2,
  cacheWrite1hPerMTok: 3,
  cacheReadPerMTok: 0.5,
  outputPerMTok: 5,
  overStep: {
    inputPerMTok: 10,
    cacheWrite5mPerMTok: 20,
    cacheWrite1hPerMTok: 30,
    cacheReadPerMTok: 5,
    outputPerMTok: 50,
  },
};
const SONNET_PRICE: ModelPrice = {
  inputPerMTok: 4,
  cacheWrite5mPerMTok: 5,
  cacheWrite1hPerMTok: 6,
  cacheReadPerMTok: 0.4,
  outputPerMTok: 8,
};
const OPUS_PRICE: ModelPrice = {
  inputPerMTok: 2,
  cacheWrite5mPerMTok: 3,
  cacheWrite1hPerMTok: 4,
  cacheReadPerMTok: 0.2,
  outputPerMTok: 10,
};

/** A token.split reading of one model's cumulative low-step input. */
const split = (ms: number, agent: string, model: string, input: number) =>
  event(ms, "token.split", {
    agent,
    model,
    lowInput: input,
    lowCacheRead: 0,
    lowOutput: 0,
    highInput: 0,
    highCacheRead: 0,
    highOutput: 0,
  });

// A haiku writer's change (100) and a sonnet writer's change (101), with the other three unjoinable:
// five merged changes, so the figure is read.
const EVENTS = [
  launch(100, "h-writer", "w1:p1", HAIKU),
  launch(150, "s-writer", "w1:p2", SONNET),
  linked(1300, 100, "h-writer"),
  linked(1330, 101, "s-writer"),
  split(1300, "h-writer", HAIKU, MILLION),
  split(1350, "s-writer", SONNET, MILLION),
  ...mergedAt(1400, 1500, 1600, 1700, 1800),
];

describe("writer cost dollars: a model the price table does not price", () => {
  it("reads the tier that ran on the unpriced model as insufficient prices, not as a zero, and the priced tier as it is", () => {
    const r = writerCost(EVENTS, WINDOW, {
      ...OPTIONS,
      prices: { [HAIKU]: HAIKU_PRICE, [OPUS]: OPUS_PRICE },
    });

    expect(
      r.current.status === "ok" &&
        r.current.tiers[SONNET]?.perMergedChangeDollars,
    ).toEqual({
      status: "insufficient prices",
      models: [SONNET],
    });
    // The haiku change's writer is 1 dollar at the low step; the sonnet change is not in its tier.
    expect(
      r.current.status === "ok" &&
        r.current.tiers[HAIKU]?.perMergedChangeDollars,
    ).toMatchObject({
      writer: 1,
      allIn: 1,
      median: 1,
    });
  });

  it("reads every tier, and the shared figure, as insufficient when the judge ran on an unpriced model", () => {
    const r = writerCost(
      [...EVENTS, split(1950, "idea7-judge", SONNET, MILLION)],
      WINDOW,
      { ...OPTIONS, prices: { [HAIKU]: HAIKU_PRICE, [OPUS]: OPUS_PRICE } },
    );

    expect(r.current.status === "ok" && r.current.judge).toEqual({
      status: "insufficient prices",
      models: [SONNET],
    });
    expect(
      r.current.status === "ok" &&
        r.current.tiers[HAIKU]?.perMergedChangeDollars,
    ).toEqual({
      status: "insufficient prices",
      models: [SONNET],
    });
  });

  it("reads every tier as insufficient when the orchestrating session's main-session model is unpriced", () => {
    const r = writerCost(
      [...EVENTS, split(1200, "main-s", OPUS, MILLION)],
      WINDOW,
      { ...OPTIONS, prices: { [HAIKU]: HAIKU_PRICE, [SONNET]: SONNET_PRICE } },
    );

    expect(r.current.status === "ok" && r.current.orchestrate).toMatchObject({
      status: "insufficient prices",
      models: [OPUS],
    });
    expect(
      r.current.status === "ok" &&
        r.current.tiers[HAIKU]?.perMergedChangeDollars,
    ).toEqual({
      status: "insufficient prices",
      models: [OPUS],
    });
  });
});
