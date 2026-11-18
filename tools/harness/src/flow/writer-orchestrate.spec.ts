import { describe, expect, it } from "vitest";
import type { ModelPrice } from "./writer-prices.js";
import { event, HAIKU, WINDOW, launch } from "./writer-cost-support.js";
import { basisOf, orchestrateDollarsIn } from "./writer-orchestrate.js";

const OPUS = "claude-opus-5-5";
const FABLE = "claude-fable-5-2";
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
  [OPUS]: {
    inputPerMTok: 2,
    cacheWrite5mPerMTok: 3,
    cacheWrite1hPerMTok: 4,
    cacheReadPerMTok: 0.2,
    outputPerMTok: 10,
  },
};

type Kind = "input" | "output";

/** A token.split reading: one model's cumulative counts at the low step and the high step, for a session. */
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
    lowOutput: low.output ?? 0,
    highInput: high.input ?? 0,
    highOutput: high.output ?? 0,
  });

/** A cumulative token.usage reading for a session with no role: the main session. */
const mainUsage = (ms: number, session: string, tokens: number) =>
  event(ms, "token.usage", { session, tokens, source: "claude" });

const NONE = {
  recorded: 0,
  assumed: 0,
  recordedModels: [],
  assumedTokens: 0,
  unpriced: [],
  basis: "none",
};

describe("orchestrate dollars: the main session priced by its recorded model", () => {
  it("prices a Haiku reading and an Opus reading in one span, each at its own model and prompt step", () => {
    const r = orchestrateDollarsIn(
      [
        // Haiku: 1M low input at 1, 1M low output at 5, 1M high input at 10 (over-step): 16.
        split(
          1100,
          "main-h",
          HAIKU,
          { input: MILLION, output: MILLION },
          { input: MILLION },
        ),
        // Opus: 1M input at 2: 2. Priced as one Opus total the same counts would read 16.
        split(1200, "main-o", OPUS, { input: MILLION }),
      ],
      WINDOW,
      PRICES,
    );

    expect(r).toEqual({
      recorded: 18,
      assumed: 0,
      recordedModels: [HAIKU, OPUS],
      assumedTokens: 0,
      unpriced: [],
      basis: "recorded",
    });
  });

  it("prices only the growth inside the span, so a reading before the span's start is not priced again", () => {
    const r = orchestrateDollarsIn(
      [
        split(500, "main-h", HAIKU, { input: MILLION }),
        split(1100, "main-h", HAIKU, { input: 3 * MILLION }),
      ],
      WINDOW,
      PRICES,
    );

    // 2M of growth at Haiku's low input rate of 1.
    expect(r).toMatchObject({ recorded: 2, recordedModels: [HAIKU] });
  });
});

describe("orchestrate dollars: which readings count", () => {
  it("leaves out a reading that falls after the span's end", () => {
    const r = orchestrateDollarsIn(
      [split(2500, "main-h", HAIKU, { input: MILLION })],
      WINDOW,
      PRICES,
    );

    expect(r).toEqual(NONE);
  });

  it("counts a roleless session in the orchestrate bucket, and a session with a role is never read as the main session", () => {
    const r = orchestrateDollarsIn(
      [
        launch(100, "w-writer", "w1:p1", HAIKU),
        split(1100, "w-writer", HAIKU, { input: MILLION }),
        split(1200, "main-o", OPUS, { input: MILLION }),
      ],
      WINDOW,
      PRICES,
    );

    expect(r).toEqual({
      recorded: 2,
      assumed: 0,
      recordedModels: [OPUS],
      assumedTokens: 0,
      unpriced: [],
      basis: "recorded",
    });
  });
});

describe("orchestrate dollars: an unpriced recorded model", () => {
  it("names a recorded model the price table does not price, counts none of its dollars and still counts the others", () => {
    const r = orchestrateDollarsIn(
      [
        split(1100, "main-f", FABLE, { input: MILLION }),
        split(1200, "main-o", OPUS, { input: MILLION }),
      ],
      WINDOW,
      PRICES,
    );

    expect(r).toEqual({
      recorded: 2,
      assumed: 0,
      recordedModels: [FABLE, OPUS],
      assumedTokens: 0,
      unpriced: [FABLE],
      basis: "recorded",
    });
  });
});

describe("orchestrate dollars: a span with no reading is priced at the assumed model", () => {
  it("prices a main session's token totals at the assumed model's input rate, a floor, when no reading is in the span", () => {
    const r = orchestrateDollarsIn(
      [
        mainUsage(900, "main-t", MILLION),
        mainUsage(1500, "main-t", 3 * MILLION),
      ],
      WINDOW,
      PRICES,
    );

    // 2M tokens of growth at Opus's input rate of 2.
    expect(r).toEqual({
      recorded: 0,
      assumed: 4,
      recordedModels: [],
      assumedTokens: 2 * MILLION,
      unpriced: [],
      basis: "assumed model",
    });
  });

  it("takes a session's dollars from its readings when it has one in the span, so its token totals are not counted twice", () => {
    const r = orchestrateDollarsIn(
      [
        mainUsage(900, "main-h", MILLION),
        mainUsage(1500, "main-h", 4 * MILLION),
        split(1400, "main-h", HAIKU, { input: 2 * MILLION }),
      ],
      WINDOW,
      PRICES,
    );

    expect(r).toEqual({
      recorded: 2,
      assumed: 0,
      recordedModels: [HAIKU],
      assumedTokens: 0,
      unpriced: [],
      basis: "recorded",
    });
  });

  it("names the assumed model as unpriced, never zero, when the price table does not price it", () => {
    const r = orchestrateDollarsIn(
      [mainUsage(900, "main-t", 0), mainUsage(1500, "main-t", 2 * MILLION)],
      WINDOW,
      { [HAIKU]: PRICES[HAIKU] as ModelPrice },
    );

    expect(r).toEqual({
      recorded: 0,
      assumed: 0,
      recordedModels: [],
      assumedTokens: 2 * MILLION,
      unpriced: [OPUS],
      basis: "assumed model",
    });
  });

  it("reads no dollars for a span with no main-session tokens at all", () => {
    const r = orchestrateDollarsIn(
      [launch(100, "w-writer", "w1:p1", HAIKU)],
      WINDOW,
      PRICES,
    );

    expect(r).toEqual(NONE);
  });
});

describe("orchestrate basis: what the figure is priced from, stated beside it", () => {
  it("reads none, recorded, assumed model, or recorded and assumed model from what the span holds", () => {
    expect(basisOf({ recordedModels: [], assumedTokens: 0 })).toBe("none");
    expect(basisOf({ recordedModels: [HAIKU], assumedTokens: 0 })).toBe(
      "recorded",
    );
    expect(basisOf({ recordedModels: [], assumedTokens: 5 })).toBe(
      "assumed model",
    );
    expect(basisOf({ recordedModels: [HAIKU], assumedTokens: 5 })).toBe(
      "recorded and assumed model",
    );
  });
});
