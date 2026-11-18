import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { bootstrapDifferenceInterval } from "./bootstrap-interval.js";
import { writerArmsIn } from "./writer-arms.js";
import { MODEL_PRICES } from "./writer-prices.js";
import { event, HAIKU, SONNET, linked } from "./writer-cost-support.js";
import {
  input,
  MINUTE,
  SCENARIO,
  SPAN,
  writer,
} from "./writer-arms-support.js";

vi.mock("./bootstrap-interval.js", () => ({
  bootstrapDifferenceInterval: vi.fn(),
}));

/** The minimum that reads a change from each arm: one, so every stratum here has data. */
const expectedBounds = { minMergedChanges: 1 };

// Merged changes added to the scenario, each one launch left out of the primary figure.
//   PR 110: Sonnet randomized at medium (another effort)  -> differentEffort
//   PR 111: Haiku randomized, no effort recorded          -> missingEffort
//   PR 112: Sonnet hand-picked at high                    -> notRandomized
//   PR 113: Haiku hand-picked, no effort recorded         -> missingEffort
//   PR 114: Haiku escalated-looking override at medium    -> notRandomized
const LEFT_OUT_PRS: [number, string, string][] = [
  [110, "d-writer", HAIKU],
  [111, "m-writer", HAIKU],
  [112, "p-writer", SONNET],
  [113, "q-writer", HAIKU],
  [114, "r-writer", HAIKU],
];
const LEFT_OUT: LedgerEvent[] = [
  writer(1 * MINUTE, "d-writer", SONNET, "medium"),
  writer(1 * MINUTE, "m-writer", HAIKU),
  writer(1 * MINUTE, "p-writer", SONNET, "high", null),
  writer(1 * MINUTE, "q-writer", HAIKU, undefined, null),
  writer(1 * MINUTE, "r-writer", HAIKU, "medium", "escalated"),
  ...LEFT_OUT_PRS.flatMap(([number, agent, tier]) => [
    input(50 * MINUTE, agent, tier, 1_000_000),
    linked(55 * MINUTE, number, agent),
    event(60 * MINUTE, "pr.merged", { number }),
  ]),
];
const WITH_LEFT_OUT = [...SCENARIO, ...LEFT_OUT];

describe("writer arms: only randomized launches at the window effort", () => {
  beforeEach(() => {
    vi.mocked(bootstrapDifferenceInterval).mockReset();
    vi.mocked(bootstrapDifferenceInterval).mockReturnValue({
      low: -3,
      high: -1,
    });
  });

  it("keeps every excluded launch out of the arms' counts and the interval's inputs", () => {
    const arms = writerArmsIn(
      WITH_LEFT_OUT,
      SPAN,
      MODEL_PRICES,
      expectedBounds,
    );

    expect(arms.overall).toMatchObject({
      haiku: { mergedChanges: 2, allInPerMergedChange: 0.2 },
      sonnet: { mergedChanges: 3, allInPerMergedChange: 2.6667 },
      difference: -2.4667,
    });
    const [haiku, sonnet] = vi.mocked(bootstrapDifferenceInterval).mock
      .calls[0] ?? [[], []];
    expect(haiku).toHaveLength(2);
    expect(sonnet).toHaveLength(3);
  });

  it("counts each excluded launch once, by its fixed reason", () => {
    const arms = writerArmsIn(
      WITH_LEFT_OUT,
      SPAN,
      MODEL_PRICES,
      expectedBounds,
    );

    expect(arms.excluded).toEqual({
      differentEffort: 1,
      missingEffort: 2,
      notRandomized: 3,
    });
  });

  it("counts the hand-picked Opus launch as not randomized though it is on neither arm's tier", () => {
    const arms = writerArmsIn(SCENARIO, SPAN, MODEL_PRICES, expectedBounds);

    expect(arms.excluded).toEqual({
      differentEffort: 0,
      missingEffort: 0,
      notRandomized: 1,
    });
  });

  it("reads a launch from before effort was recorded as a missing effort, never in the figure", () => {
    const old = SCENARIO.map((e): LedgerEvent => {
      const { effort: _effort, tierReason: _reason, ...rest } = e;
      return e.kind === "session.launch" ? rest : e;
    });
    const arms = writerArmsIn(old, SPAN, MODEL_PRICES, expectedBounds);

    expect(arms.excluded.missingEffort).toBe(6);
    expect(arms.overall).toMatchObject({
      status: "insufficient merged changes",
      haiku: { mergedChanges: 0 },
      sonnet: { mergedChanges: 0 },
    });
  });
});

describe("writer arms: the strata of the restricted figure", () => {
  beforeEach(() => {
    vi.mocked(bootstrapDifferenceInterval).mockReset();
    vi.mocked(bootstrapDifferenceInterval).mockReturnValue({
      low: -3,
      high: -1,
    });
  });

  it("applies the minimum per stratum to the restricted counts", () => {
    const arms = writerArmsIn(WITH_LEFT_OUT, SPAN, MODEL_PRICES, {
      minMergedChanges: 2,
    });
    const harness = arms.strata.find((r) => r.label === "harness");

    expect(harness).toMatchObject({ status: "insufficient merged changes" });
    expect(arms.overall).toMatchObject({ status: "ok" });
  });

  it("never makes effort a stratum", () => {
    const arms = writerArmsIn(
      WITH_LEFT_OUT,
      SPAN,
      MODEL_PRICES,
      expectedBounds,
    );

    expect(arms.strata.map((row) => row.label)).toEqual([
      "enhancement",
      "harness",
    ]);
  });
});

describe("writer arms: the window effort", () => {
  beforeEach(() => {
    vi.mocked(bootstrapDifferenceInterval).mockReset();
    vi.mocked(bootstrapDifferenceInterval).mockReturnValue({
      low: -3,
      high: -1,
    });
  });

  it("reads the window effort from the explicit setting, and says so", () => {
    const arms = writerArmsIn(WITH_LEFT_OUT, SPAN, MODEL_PRICES, {
      ...expectedBounds,
      windowEffort: "medium",
    });

    expect(arms.windowEffort).toEqual({ effort: "medium", from: "setting" });
    expect(arms.overall).toMatchObject({
      haiku: { mergedChanges: 0 },
      sonnet: { mergedChanges: 1, effort: { medium: 1 } },
    });
    expect(arms.excluded).toEqual({
      differentEffort: 5,
      missingEffort: 2,
      notRandomized: 3,
    });
  });

  it("defaults the window effort to the most common randomized effort, and says so", () => {
    const arms = writerArmsIn(
      WITH_LEFT_OUT,
      SPAN,
      MODEL_PRICES,
      expectedBounds,
    );

    expect(arms.windowEffort).toEqual({ effort: "high", from: "most common" });
  });

  it("has no window effort and an empty figure when no randomized launch recorded one", () => {
    const none = SCENARIO.filter((e) => e.kind !== "session.launch");
    const arms = writerArmsIn(none, SPAN, MODEL_PRICES, expectedBounds);

    expect(arms.windowEffort).toEqual({ effort: null, from: "none" });
    expect(arms.overall).toMatchObject({
      status: "insufficient merged changes",
    });
  });
});
