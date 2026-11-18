import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import type { ModelPrice } from "./writer-prices.js";
import {
  NO_COUNTS,
  priceCounts,
  spendBefore,
  type Counts,
} from "./writer-dollars.js";
import { event } from "./writer-cost-support.js";

// A fixture price table, so the exact dollars below do not move with the published table.
const PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-haiku-5-5": {
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
  "claude-sonnet-5-5": {
    inputPerMTok: 4,
    cacheWrite5mPerMTok: 5,
    cacheWrite1hPerMTok: 6,
    cacheReadPerMTok: 0.4,
    outputPerMTok: 8,
  },
};

const ZERO = {
  input: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  output: 0,
};

/** Counts for one model with the low step's and the high step's kinds (each a whole million or part of one). */
const counts = (
  low: Partial<typeof ZERO>,
  high: Partial<typeof ZERO> = {},
): Counts => ({
  low: { ...ZERO, ...low },
  high: { ...ZERO, ...high },
});

describe("writer dollars: a request priced at its own step", () => {
  it("prices a Haiku request under 100K at the low step, every kind of token at its own rate", () => {
    const c = counts({
      input: 1_000_000,
      cacheWrite5m: 1_000_000,
      cacheWrite1h: 1_000_000,
      cacheRead: 2_000_000,
      output: 1_000_000,
    });

    // 1 + 2 + 3 + (2 x 0.5) + 5 dollars.
    expect(priceCounts(c, "claude-haiku-5-5", PRICES)).toBeCloseTo(12, 9);
  });

  it("prices a Haiku request over 100K entirely at the high step, cache reads included", () => {
    const c = counts(
      {},
      {
        input: 1_000_000,
        cacheRead: 1_000_000,
        output: 500_000,
      },
    );

    // 10 for input, 5 for cache reads at the high step's 5, and 25 for output at its 50.
    expect(priceCounts(c, "claude-haiku-5-5", PRICES)).toBeCloseTo(40, 9);
  });

  it("prices a Sonnet request at the same rates on both sides, since Sonnet has no step", () => {
    const c = counts(
      { input: 1_000_000, cacheRead: 1_000_000 },
      { input: 1_000_000 },
    );

    // Low: 4 + 0.4; high: 4 at the same input rate.
    expect(priceCounts(c, "claude-sonnet-5-5", PRICES)).toBeCloseTo(8.4, 9);
  });

  it("returns no price for a model the table does not price, never a zero", () => {
    expect(
      priceCounts(counts({ input: 1_000_000 }), "claude-mystery-1", PRICES),
    ).toBeUndefined();
  });

  it("prices no tokens as zero dollars for a model with none", () => {
    expect(priceCounts(NO_COUNTS, "claude-haiku-5-5", PRICES)).toBe(0);
  });
});

/** A token.split reading of one model's cumulative counts, as the stop hook writes it. */
const split = (
  ms: number,
  agent: string,
  model: string,
  low: Partial<typeof ZERO>,
  high: Partial<typeof ZERO> = {},
): LedgerEvent =>
  event(ms, "token.split", {
    agent,
    model,
    lowInput: low.input ?? 0,
    lowCacheWrite5m: low.cacheWrite5m ?? 0,
    lowCacheWrite1h: low.cacheWrite1h ?? 0,
    lowCacheRead: low.cacheRead ?? 0,
    lowOutput: low.output ?? 0,
    highInput: high.input ?? 0,
    highCacheWrite5m: high.cacheWrite5m ?? 0,
    highCacheWrite1h: high.cacheWrite1h ?? 0,
    highCacheRead: high.cacheRead ?? 0,
    highOutput: high.output ?? 0,
  });

const STAGE_WRITE = () => "write" as const;

describe("writer dollars: spend before a time", () => {
  it("keeps each model's latest cumulative reading, so a streamed repeat replaces its earlier count", () => {
    const spend = spendBefore(
      [
        split(100, "a-writer", "claude-haiku-5-5", { input: 10 }),
        split(200, "a-writer", "claude-haiku-5-5", { input: 40 }),
        split(300, "a-writer", "claude-haiku-5-5", { input: 40, output: 5 }),
      ],
      1000,
      STAGE_WRITE,
    );

    expect(spend.get("a-writer")).toEqual({
      stage: "write",
      byModel: new Map([
        ["claude-haiku-5-5", counts({ input: 40, output: 5 })],
      ]),
    });
  });

  it("leaves out a reading at or after the time, so a span's start and end read the spend before them", () => {
    const spend = spendBefore(
      [
        split(100, "a-writer", "claude-haiku-5-5", { input: 10 }),
        split(1000, "a-writer", "claude-haiku-5-5", { input: 99 }),
      ],
      1000,
      STAGE_WRITE,
    );

    expect(spend.get("a-writer")?.byModel.get("claude-haiku-5-5")).toEqual(
      counts({ input: 10 }),
    );
  });

  it("keys a session by its agent name, and a main-session reading by its session", () => {
    const spend = spendBefore(
      [
        split(100, "a-writer", "claude-haiku-5-5", { input: 10 }),
        event(120, "token.split", {
          session: "main-s",
          model: "claude-opus-5-5",
          lowInput: 7,
        }),
      ],
      1000,
      () => "orchestrate" as const,
    );

    expect([...spend.keys()].sort()).toEqual(["a-writer", "main-s"]);
  });
});
