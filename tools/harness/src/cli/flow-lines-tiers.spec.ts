import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SEND_BACK_CATEGORIES,
  type SendBackCategory,
} from "../ledger/index.js";
import { breakEvenReportLines } from "./flow-lines-break-even.js";
import { violationReportLines } from "./flow-lines-violations.js";
import { reviewRoundReportLines } from "./flow-lines-review-rounds.js";
import { sendBackTierReportLines } from "./flow-lines-send-back-split.js";
import { writerTierReportLines, type TierReport } from "./flow-lines-tiers.js";

vi.mock("./flow-lines-break-even.js");
vi.mock("./flow-lines-violations.js");
vi.mock("./flow-lines-review-rounds.js");
vi.mock("./flow-lines-send-back-split.js");

const NO_SEND_BACKS = {
  byCategory: Object.fromEntries(
    SEND_BACK_CATEGORIES.map((c) => [c, 0]),
  ) as Record<SendBackCategory, number>,
  legacy: 0,
  uncategorised: 0,
  otherThreshold: 0.1,
  categorised: 0,
  otherShare: null,
  minCategorised: 20,
  otherReading: "insufficient" as const,
  otherOverThreshold: false,
};

/** A report literal with only the tier figures the lines read; the line modules are mocked, so no value matters. */
const REPORT: TierReport = {
  sendBackTiers: {
    tiers: {},
    unlinked: { mergedChanges: 0, sendBacks: NO_SEND_BACKS },
  },
  reviewRounds: {
    tiers: {},
    unlinked: {
      mergedChanges: 0,
      failedReviewRounds: 0,
      reviewedChanges: 0,
      reviewCoverage: null,
    },
  },
  violationsByRule: {
    tiers: {},
    unlinked: { failedVerdicts: 0, unlabelled: 0, citations: 0, rules: [] },
  },
  breakEven: { status: "insufficient prices", models: [] },
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("writerTierReportLines: the per-writer-tier lines of the flow report text", () => {
  it("prints the send-back lines, then the failed review round and coverage lines, the violations by rule and the break-even, each read from the same report", () => {
    vi.mocked(sendBackTierReportLines).mockReturnValue(["send-back line"]);
    vi.mocked(reviewRoundReportLines).mockReturnValue(["review line"]);
    vi.mocked(violationReportLines).mockReturnValue(["violation line"]);
    vi.mocked(breakEvenReportLines).mockReturnValue(["break-even line"]);

    expect(writerTierReportLines(REPORT)).toEqual([
      "send-back line",
      "review line",
      "violation line",
      "break-even line",
    ]);
    expect(violationReportLines).toHaveBeenCalledWith(REPORT);
    expect(breakEvenReportLines).toHaveBeenCalledWith(REPORT);
    expect(sendBackTierReportLines).toHaveBeenCalledWith(REPORT);
    expect(reviewRoundReportLines).toHaveBeenCalledWith(REPORT);
  });
});
