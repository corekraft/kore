import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { writerDollarsIn } from "./writer-attribution.js";
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

// A fixture price table, so the dollars below do not move with the published table. Haiku has a
// step: a request over 100K pays its over-step rates, cache reads included.
const PRICES: Readonly<Record<string, ModelPrice>> = {
  [HAIKU]: {
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
  },
  [SONNET]: {
    inputPerMTok: 4,
    cacheWrite5mPerMTok: 5,
    cacheWrite1hPerMTok: 6,
    cacheReadPerMTok: 0.4,
    outputPerMTok: 8,
  },
  [OPUS]: {
    inputPerMTok: 2,
    cacheWrite5mPerMTok: 3,
    cacheWrite1hPerMTok: 4,
    cacheReadPerMTok: 0.2,
    outputPerMTok: 10,
  },
};

const DOLLARS = { ...OPTIONS, prices: PRICES };

type Kind = "input" | "cacheRead" | "output";

/** A token.split reading: one model's cumulative counts at the low step and the high step. */
const split = (
  ms: number,
  agent: string,
  model: string,
  low: Partial<Record<Kind, number>>,
  high: Partial<Record<Kind, number>> = {},
) =>
  event(ms, "token.split", {
    agent,
    model,
    lowInput: low.input ?? 0,
    lowCacheRead: low.cacheRead ?? 0,
    lowOutput: low.output ?? 0,
    highInput: high.input ?? 0,
    highCacheRead: high.cacheRead ?? 0,
    highOutput: high.output ?? 0,
  });

// Five merged changes in the window. Three link to haiku writers (100, 102, 103), one to a sonnet
// writer (101), and 104 links to no one, so it is unjoinable.
const TIERS_EVENTS = [
  launch(100, "h-writer", "w1:p1", HAIKU),
  launch(110, "h2-writer", "w1:p2", HAIKU),
  launch(120, "h3-writer", "w1:p3", HAIKU),
  launch(150, "s-writer", "w1:p4", SONNET),
  // Spend with no link to any merged change: a stated limit, in no tier and in no change's figure.
  launch(160, "x-writer", "w1:p5", HAIKU),
  linked(1300, 100, "h-writer"),
  linked(1310, 102, "h2-writer"),
  linked(1320, 103, "h3-writer"),
  linked(1330, 101, "s-writer"),
  // h-writer: 1M low + 1M high input at 1300 (1 + 10); its 1450 reading comes after PR 100 merges and is left out.
  split(1300, "h-writer", HAIKU, { input: MILLION }, { input: MILLION }),
  split(1450, "h-writer", HAIKU, { input: 2 * MILLION }, { input: MILLION }),
  split(1550, "h2-writer", HAIKU, { input: MILLION }),
  split(1650, "h3-writer", HAIKU, { input: 3 * MILLION }),
  split(1350, "s-writer", SONNET, { input: MILLION }),
  // The reviewer of PR 100, named for its PR, is its own part; the judge and main session are shared.
  split(1380, "pr100-reviewer", SONNET, { input: MILLION }),
  split(1950, "idea7-judge", SONNET, { input: MILLION }),
  split(1200, "main-s", OPUS, { input: MILLION }),
  split(1500, "x-writer", HAIKU, { input: 5 * MILLION }),
  ...mergedAt(1400, 1500, 1600, 1700, 1800),
];

describe("writer cost dollars: all-in cost per merged change by first-launch tier", () => {
  it("prices each part of a merged change in dollars, the mean of each part and the median of the all-in totals per tier", () => {
    const r = writerCost(TIERS_EVENTS, WINDOW, DOLLARS);

    expect(r.current).toMatchObject({
      status: "ok",
      merged: 5,
      unjoinable: 1,
      unmergedWriterSessions: 1,
      judge: { dollars: 4, dollarsPerMergedChange: 0.8 },
      orchestrate: {
        model: OPUS,
        dollars: 2,
        dollarsPerMergedChange: 0.4,
      },
    });
    // Haiku: changes 100 (writer 11, reviewer 4), 102 (writer 1), 103 (writer 3); each carries 1.2 shared.
    // Means: writer 5, reviewer 1.3333, all-in 7.5333. Median of the totals 16.2, 2.2, 4.2: 4.2.
    expect(
      r.current.status === "ok" && r.current.tiers["claude-haiku-5-5"],
    ).toMatchObject({
      mergedChanges: 3,
      perMergedChangeDollars: {
        writer: 5,
        reviewer: 1.3333,
        judge: 0.8,
        orchestrate: 0.4,
        allIn: 7.5333,
        median: 4.2,
      },
    });
    // Sonnet: change 101's writer 4, no reviewer, and the shared 1.2: all-in 5.2, and its median too.
    expect(
      r.current.status === "ok" && r.current.tiers["claude-sonnet-5-5"],
    ).toMatchObject({
      mergedChanges: 1,
      perMergedChangeDollars: {
        writer: 4,
        reviewer: 0,
        judge: 0.8,
        orchestrate: 0.4,
        allIn: 5.2,
        median: 5.2,
      },
    });
  });

  it("reads a writer's whole life to its merge, so spend after the merge is left out", () => {
    const r = writerCost(TIERS_EVENTS, WINDOW, DOLLARS);

    // 11 at the 1300 reading, not 12 with the 1450 reading that comes after PR 100 merged.
    expect(
      r.current.status === "ok" &&
        r.current.tiers["claude-haiku-5-5"]?.perMergedChangeDollars,
    ).toMatchObject({ writer: 5 });
  });

  it("leaves a merged change with no joinable writer out of every tier, though it still divides the shared spend", () => {
    const r = writerCost(TIERS_EVENTS, WINDOW, DOLLARS);

    // The shared 6 (judge 4, orchestrate 2) is divided by all five merged changes, 1.2 each, not by the four joined.
    expect(r.current.status === "ok" && r.current.judge).toMatchObject({
      dollarsPerMergedChange: 0.8,
    });
    expect(r.current.status === "ok" && r.current.unjoinable).toBe(1);
  });
});

describe("writer cost dollars: a writer with several merged changes", () => {
  it("splits its whole-life cost equally across its merged linked changes, so the shares add to the whole", () => {
    const r = writerCost(
      [
        launch(100, "w-writer", "w1:p1", SONNET),
        linked(1300, 100, "w-writer"),
        linked(1310, 101, "w-writer"),
        split(1300, "w-writer", SONNET, { input: 2 * MILLION }),
        split(1450, "w-writer", SONNET, { input: 4 * MILLION }),
        ...mergedAt(1400, 1500, 1600, 1700, 1800),
      ],
      WINDOW,
      DOLLARS,
    );

    // Its whole life to its last merge (1500) is 4M input at 4 dollars: 16, split over two changes: 8 each.
    expect(
      r.current.status === "ok" && r.current.tiers["claude-sonnet-5-5"],
    ).toMatchObject({
      mergedChanges: 2,
      perMergedChangeDollars: { writer: 8, allIn: 8, median: 8 },
    });
  });
});

describe("writer cost dollars: a window with no joined change", () => {
  it("reads a tier with no merged change joined to it as no dollars, never as zero", () => {
    const r = writerCost(
      [
        launch(100, "w-writer", "w1:p1", SONNET),
        split(1300, "w-writer", SONNET, { input: MILLION }),
        ...mergedAt(1400, 1500, 1600, 1700, 1800),
      ],
      WINDOW,
      DOLLARS,
    );

    expect(
      r.current.status === "ok" &&
        r.current.tiers["claude-sonnet-5-5"]?.perMergedChangeDollars,
    ).toBeNull();
  });
});

const isMainSplit = (e: LedgerEvent) =>
  e.kind === "token.split" && e.agent === "main-s";

describe("writer cost dollars: the main session's basis beside its figure (#1041)", () => {
  it("reads the main session as recorded, at its Opus reading, beside the orchestrate figure", () => {
    const r = writerCost(TIERS_EVENTS, WINDOW, DOLLARS);

    expect(r.current).toMatchObject({
      status: "ok",
      orchestrate: {
        basis: "recorded",
        recordedModels: [OPUS],
        assumedTokens: 0,
        dollars: 2,
      },
    });
  });

  it("prices a main session with token totals and no reading at the assumed model, and says so", () => {
    const events = [
      ...TIERS_EVENTS.filter((e) => !isMainSplit(e)),
      event(1200, "token.usage", {
        session: "main-s",
        tokens: 0,
        source: "claude",
      }),
      event(1500, "token.usage", {
        session: "main-s",
        tokens: MILLION,
        source: "claude",
      }),
    ];
    const r = writerCost(events, WINDOW, DOLLARS);

    // 1M tokens of growth at Opus's input rate of 2, the assumed model.
    expect(r.current).toMatchObject({
      status: "ok",
      orchestrate: {
        basis: "assumed model",
        recordedModels: [],
        assumedTokens: MILLION,
        model: OPUS,
        dollars: 2,
      },
    });
  });

  it("never assigns the main session's dollars to a merged change: each change's writer and reviewer parts are the same with or without it", () => {
    const without = writerDollarsIn(
      TIERS_EVENTS.filter((e) => !isMainSplit(e)),
      WINDOW,
      PRICES,
    );
    const withMain = writerDollarsIn(TIERS_EVENTS, WINDOW, PRICES);

    expect(withMain.changes).toEqual(without.changes);
    expect(withMain.shared.orchestrate).toBe(2);
    expect(without.shared.orchestrate).toBe(0);
  });
});
