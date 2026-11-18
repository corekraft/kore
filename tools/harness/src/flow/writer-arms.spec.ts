import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { bootstrapDifferenceInterval } from "./bootstrap-interval.js";
import {
  ARM_CONFIDENCE,
  ARM_RESAMPLES,
  ARM_SEED,
  writerArmsIn,
} from "./writer-arms.js";
import { MODEL_PRICES } from "./writer-prices.js";
import {
  event,
  HAIKU,
  SONNET,
  linked,
  mergedAt,
} from "./writer-cost-support.js";

// The interval is the generator's dependency: each arm's comparison is tested with it mocked.
vi.mock("./bootstrap-interval.js", () => ({
  bootstrapDifferenceInterval: vi.fn(),
}));

const MINUTE = 60_000;
const SPAN: [number, number] = [0, 100 * MINUTE];
const OPUS = "claude-opus-5-5";
const MYSTERY = "claude-mystery-9";

const round = (value: number) => Math.round(value * 10_000) / 10_000;

const writer = (
  ms: number,
  agent: string,
  tier: string,
  effort?: string,
): LedgerEvent =>
  event(ms, "session.launch", {
    agent,
    pane: `w:${agent}`,
    role: "writer",
    tier,
    ...(effort === undefined ? {} : { effort }),
  });

/** A session's cumulative input tokens on one model, read at a time (a token.split reading). */
const input = (ms: number, agent: string, model: string, tokens: number) =>
  event(ms, "token.split", {
    agent,
    model,
    lowInput: tokens,
    lowCacheWrite5m: 0,
    lowCacheWrite1h: 0,
    lowCacheRead: 0,
    lowOutput: 0,
    lowRequests: 1,
    highRequests: 0,
    highInput: 0,
    highCacheWrite5m: 0,
    highCacheWrite1h: 0,
    highCacheRead: 0,
    highOutput: 0,
  });

const labelled = (agent: string, label: string) =>
  event(0, "session.labelled", { session: agent, label });

const result = (ms: number, agent: string, outcome: "done" | "blocked") =>
  event(ms, "session.result", { agent, result: outcome });

const sendBack = (ms: number, number: number) =>
  event(ms, "send-back", { number });

const ownerAction = (ms: number, number: number) =>
  event(ms, "owner.action", { number });

// Five merged changes on the arms, and one on an Opus writer that is in neither arm.
//   PR 100: Haiku writer h1 (high), label enhancement, 1M input tokens  -> $0.10
//   PR 101: Haiku writer h2 (high), label harness,     3M input tokens  -> $0.30
//   PR 102: Sonnet writer s1 (medium), label enhancement, 2M tokens     -> $4.00
//   PR 103: Sonnet writer s2 (medium), label harness,    1M tokens     -> $2.00
//   PR 104: Sonnet writer s3 (no effort recorded), no label, 1M tokens -> $2.00
//   PR 105: Opus writer o1, label harness, 1M tokens: in neither arm.
const SCENARIO: LedgerEvent[] = [
  writer(1 * MINUTE, "h1-writer", HAIKU, "high"),
  writer(1 * MINUTE, "h2-writer", HAIKU, "high"),
  writer(1 * MINUTE, "s1-writer", SONNET, "medium"),
  writer(1 * MINUTE, "s2-writer", SONNET, "medium"),
  writer(1 * MINUTE, "s3-writer", SONNET),
  writer(1 * MINUTE, "o1-writer", OPUS, "high"),
  labelled("h1-writer", "enhancement"),
  labelled("h2-writer", "harness"),
  labelled("s1-writer", "enhancement"),
  labelled("s2-writer", "harness"),
  labelled("o1-writer", "harness"),
  input(50 * MINUTE, "h1-writer", HAIKU, 1_000_000),
  input(50 * MINUTE, "h2-writer", HAIKU, 3_000_000),
  input(50 * MINUTE, "s1-writer", SONNET, 2_000_000),
  input(50 * MINUTE, "s2-writer", SONNET, 1_000_000),
  input(50 * MINUTE, "s3-writer", SONNET, 1_000_000),
  input(50 * MINUTE, "o1-writer", OPUS, 1_000_000),
  linked(55 * MINUTE, 100, "h1-writer"),
  linked(55 * MINUTE, 101, "h2-writer"),
  linked(55 * MINUTE, 102, "s1-writer"),
  linked(55 * MINUTE, 103, "s2-writer"),
  linked(55 * MINUTE, 104, "s3-writer"),
  linked(55 * MINUTE, 105, "o1-writer"),
  ...mergedAt(
    60 * MINUTE,
    70 * MINUTE,
    80 * MINUTE,
    90 * MINUTE,
    95 * MINUTE,
    97 * MINUTE,
  ),
  result(62 * MINUTE, "h1-writer", "blocked"),
  result(72 * MINUTE, "h2-writer", "done"),
  result(82 * MINUTE, "s1-writer", "done"),
  result(92 * MINUTE, "s2-writer", "blocked"),
  result(96 * MINUTE, "s3-writer", "done"),
  sendBack(61 * MINUTE, 100),
  sendBack(91 * MINUTE, 103),
  ownerAction(61 * MINUTE, 100),
  ownerAction(62 * MINUTE, 100),
  ownerAction(85 * MINUTE, 103),
  ownerAction(88 * MINUTE, 103),
];

/** The minimum that reads a change from each arm: one, so every stratum here has data. */
const expectedBounds = { minMergedChanges: 1 };

describe("writer arms: the overall comparison", () => {
  beforeEach(() => {
    vi.mocked(bootstrapDifferenceInterval).mockReset();
    vi.mocked(bootstrapDifferenceInterval).mockReturnValue({
      low: -3,
      high: -1,
    });
  });

  it("gives each arm's all-in dollars per merged change, and their difference, Haiku minus Sonnet", () => {
    const arms = writerArmsIn(SCENARIO, SPAN, MODEL_PRICES, expectedBounds);

    expect(arms.overall).toMatchObject({
      label: null,
      status: "ok",
      haiku: { tier: HAIKU, mergedChanges: 2, allInPerMergedChange: 0.2 },
      sonnet: { tier: SONNET, mergedChanges: 3, allInPerMergedChange: 2.6667 },
      difference: -2.4667,
      interval: { low: -3, high: -1 },
    });
  });

  it("leaves a change on another tier out of both arms, and counts no unlabelled change in a stratum", () => {
    const arms = writerArmsIn(SCENARIO, SPAN, MODEL_PRICES, expectedBounds);

    expect(arms.overall).toMatchObject({
      haiku: { mergedChanges: 2 },
      sonnet: { mergedChanges: 3 },
    });
    expect(arms.unlabelled).toBe(1);
    expect(arms.strata.map((row) => row.label)).toEqual([
      "enhancement",
      "harness",
    ]);
  });

  it("seeds the interval with the fixed seed, and passes each arm's per-change totals to it", () => {
    writerArmsIn(SCENARIO, SPAN, MODEL_PRICES, expectedBounds);

    const [haiku, sonnet, options] = vi.mocked(bootstrapDifferenceInterval).mock
      .calls[0] as [number[], number[], unknown];
    expect(haiku.map(round)).toEqual([0.1, 0.3]);
    expect(sonnet.map(round)).toEqual([4, 2, 2]);
    expect(options).toEqual({
      seed: ARM_SEED,
      resamples: ARM_RESAMPLES,
      confidence: ARM_CONFIDENCE,
    });
  });
});

describe("writer arms: strata by label", () => {
  beforeEach(() => {
    vi.mocked(bootstrapDifferenceInterval).mockReset();
    vi.mocked(bootstrapDifferenceInterval).mockReturnValue({
      low: -3,
      high: -1,
    });
  });

  it("gives each stratum its own difference, with each arm's merged-change count", () => {
    const arms = writerArmsIn(SCENARIO, SPAN, MODEL_PRICES, expectedBounds);
    const byLabel = Object.fromEntries(
      arms.strata.map((row) => [row.label, row]),
    );

    expect(byLabel.enhancement).toMatchObject({
      status: "ok",
      haiku: { mergedChanges: 1, allInPerMergedChange: 0.1 },
      sonnet: { mergedChanges: 1, allInPerMergedChange: 4 },
      difference: -3.9,
    });
    expect(byLabel.harness).toMatchObject({
      status: "ok",
      haiku: { mergedChanges: 1, allInPerMergedChange: 0.3 },
      sonnet: { mergedChanges: 1, allInPerMergedChange: 2 },
      difference: -1.7,
    });
  });

  it("reads a stratum with too few merged changes in one arm as insufficient, never as a zero", () => {
    const arms = writerArmsIn(SCENARIO, SPAN, MODEL_PRICES, {
      minMergedChanges: 2,
    });
    const enhancement = arms.strata.find((r) => r.label === "enhancement");

    expect(enhancement).toMatchObject({
      status: "insufficient merged changes",
      needed: 2,
      haiku: { mergedChanges: 1 },
      sonnet: { mergedChanges: 1 },
    });
    expect(enhancement).not.toHaveProperty("difference");
    expect(enhancement).not.toHaveProperty("interval");
    expect(arms.overall).toMatchObject({ status: "ok" });
  });

  it("never calls the interval for a stratum that is insufficient", () => {
    writerArmsIn(SCENARIO, SPAN, MODEL_PRICES, { minMergedChanges: 2 });

    expect(bootstrapDifferenceInterval).toHaveBeenCalledTimes(1);
  });
});

describe("writer arms: the guards and the effort of each arm", () => {
  beforeEach(() => {
    vi.mocked(bootstrapDifferenceInterval).mockReset();
    vi.mocked(bootstrapDifferenceInterval).mockReturnValue({
      low: -3,
      high: -1,
    });
  });

  it("reads each arm's blocked share, send-backs and owner minutes per merged change", () => {
    const arms = writerArmsIn(SCENARIO, SPAN, MODEL_PRICES, expectedBounds);

    expect(arms.overall).toMatchObject({
      haiku: {
        blockedShare: 0.5,
        sendBacksPerMergedChange: 0.5,
        ownerMinutesPerMergedChange: 0.5,
      },
      sonnet: {
        blockedShare: 0.3333,
        sendBacksPerMergedChange: 0.3333,
        ownerMinutesPerMergedChange: 1,
      },
    });
  });

  it("states each arm's effort, and reads a launch from before effort was recorded as unknown", () => {
    const arms = writerArmsIn(SCENARIO, SPAN, MODEL_PRICES, expectedBounds);

    expect(arms.overall).toMatchObject({
      haiku: { effort: { high: 2 } },
      sonnet: { effort: { medium: 2, unknown: 1 } },
    });
  });

  it("reads an arm with no merged change as not read, never as a zero", () => {
    const withoutSonnet = SCENARIO.filter(
      (e) =>
        !["s1-writer", "s2-writer", "s3-writer"].includes(e.agent ?? "") &&
        ![102, 103, 104].includes(e.number ?? -1),
    );
    const arms = writerArmsIn(withoutSonnet, SPAN, MODEL_PRICES, {
      minMergedChanges: 1,
    });

    expect(arms.overall).toMatchObject({
      status: "insufficient merged changes",
      sonnet: { mergedChanges: 0, allInPerMergedChange: null },
    });
  });
});

describe("writer arms: a model the price table does not price", () => {
  beforeEach(() => {
    vi.mocked(bootstrapDifferenceInterval).mockReset();
    vi.mocked(bootstrapDifferenceInterval).mockReturnValue({
      low: -3,
      high: -1,
    });
  });

  it("names the unpriced model and reads the figure as insufficient prices, never as a dollar figure", () => {
    const priced = [
      ...SCENARIO,
      input(58 * MINUTE, "pr100-reviewer", MYSTERY, 1),
    ];
    const arms = writerArmsIn(priced, SPAN, MODEL_PRICES, expectedBounds);
    const enhancement = arms.strata.find((r) => r.label === "enhancement");

    expect(arms.overall).toMatchObject({
      status: "insufficient prices",
      models: [MYSTERY],
    });
    expect(arms.overall).not.toHaveProperty("difference");
    expect(enhancement).toMatchObject({
      status: "insufficient prices",
      models: [MYSTERY],
    });
  });

  it("still reads a stratum whose changes are all priced", () => {
    const priced = [
      ...SCENARIO,
      input(58 * MINUTE, "pr100-reviewer", MYSTERY, 1),
    ];
    const arms = writerArmsIn(priced, SPAN, MODEL_PRICES, expectedBounds);
    const harness = arms.strata.find((r) => r.label === "harness");

    expect(harness).toMatchObject({ status: "ok", difference: -1.7 });
  });
});

describe("writer arms: the wording", () => {
  it("names no winner, margin or verdict in any row", () => {
    vi.mocked(bootstrapDifferenceInterval).mockReturnValue({
      low: -3,
      high: -1,
    });
    const arms = writerArmsIn(SCENARIO, SPAN, MODEL_PRICES, expectedBounds);
    const keys = JSON.stringify([arms.overall, arms.strata]);

    expect(keys).not.toMatch(/winner|verdict|margin|cheaper/i);
  });
});
