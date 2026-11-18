import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import {
  reviewViolationFiguresIn,
  type ReviewViolationFigures,
} from "./review-violation-figures.js";
import { NO_VIOLATIONS } from "./violation-rules.js";
import { NO_SEND_BACK_TIERS } from "./send-back-tiers.js";
import { sendBackTiersSplitIn } from "./send-back-tiers-split.js";
import { writerArmsIn } from "./writer-arms.js";
import { mergedChangeWriterCost } from "./writer-cost.js";
import { writerFiguresIn } from "./writer-figures.js";
import type { Span } from "./scope.js";

vi.mock("./writer-arms.js");
vi.mock("./writer-cost.js");
vi.mock("./send-back-tiers-split.js");
vi.mock("./review-violation-figures.js");

const WINDOW: Span = [0, 1000];
const ASOF = new Date(1000);
const SPLIT_AT = new Date("2026-11-16T00:00:00Z");
const EVENTS: LedgerEvent[] = [];
const VIOLATION_FIGURES: ReviewViolationFigures = {
  violationsByRule: NO_VIOLATIONS,
  breakEven: {
    status: "insufficient merged changes",
    needed: 5,
    haiku: { tier: "h", mergedChanges: 0 },
    sonnet: { tier: "s", mergedChanges: 0 },
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sendBackTiersSplitIn).mockReturnValue({});
  vi.mocked(reviewViolationFiguresIn).mockReturnValue(VIOLATION_FIGURES);
});

describe("writerFiguresIn: the split date reaches the tier figures (#1047)", () => {
  it("carries the split of the send-backs per writer tier beside the unsplit ones, read over the same events and window", () => {
    const sendBackTiersSplit = {
      at: SPLIT_AT.toISOString(),
      before: NO_SEND_BACK_TIERS,
      after: NO_SEND_BACK_TIERS,
    };
    vi.mocked(sendBackTiersSplitIn).mockReturnValue({ sendBackTiersSplit });

    const figures = writerFiguresIn(EVENTS, WINDOW, {
      asOf: ASOF,
      splitAt: SPLIT_AT,
    });

    expect(figures.sendBackTiersSplit).toBe(sendBackTiersSplit);
    expect(figures.sendBackTiers.unlinked.mergedChanges).toBe(0);
    expect(sendBackTiersSplitIn).toHaveBeenCalledWith(
      EVENTS,
      WINDOW,
      SPLIT_AT,
      20,
    );
  });

  it("has no sendBackTiersSplit key when the split module gives none, so the figures keep the keys they had", () => {
    const figures = writerFiguresIn(EVENTS, WINDOW, { asOf: ASOF });

    expect("sendBackTiersSplit" in figures).toBe(false);
    expect(Object.keys(figures)).toEqual([
      "writerCost",
      "writerArms",
      "sendBackTiers",
      "reviewRounds",
      "violationsByRule",
      "breakEven",
    ]);
    expect(sendBackTiersSplitIn).toHaveBeenCalledWith(
      EVENTS,
      WINDOW,
      undefined,
      20,
    );
    expect(mergedChangeWriterCost).toHaveBeenCalledTimes(1);
    expect(writerArmsIn).toHaveBeenCalledTimes(1);
  });
});

describe("writerFiguresIn: the violations by rule and the break-even (#1051)", () => {
  it("carries the violations and the break-even as the figures module reads them, over the same events, window and split date, against the minimum merged changes", () => {
    const figures = writerFiguresIn(EVENTS, WINDOW, {
      asOf: ASOF,
      splitAt: SPLIT_AT,
      cost: { minMergedChanges: 3 },
    });

    expect(figures.violationsByRule).toBe(VIOLATION_FIGURES.violationsByRule);
    expect(figures.breakEven).toBe(VIOLATION_FIGURES.breakEven);
    expect(reviewViolationFiguresIn).toHaveBeenCalledWith(
      EVENTS,
      WINDOW,
      SPLIT_AT,
      3,
    );
  });

  it("reads the break-even against the default minimum merged changes when the cost settings leave it out", () => {
    writerFiguresIn(EVENTS, WINDOW, { asOf: ASOF });

    expect(reviewViolationFiguresIn).toHaveBeenCalledWith(
      EVENTS,
      WINDOW,
      undefined,
      5,
    );
  });
});
