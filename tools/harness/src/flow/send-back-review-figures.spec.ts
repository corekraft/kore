import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { reviewRoundsIn, type ReviewRounds } from "./review-rounds.js";
import { reviewRoundsSplitIn } from "./review-rounds-split.js";
import type { Span } from "./scope.js";
import { NO_SEND_BACK_TIERS, sendBackTiersIn } from "./send-back-tiers.js";
import { sendBackTiersSplitIn } from "./send-back-tiers-split.js";
import { sendBackAndReviewFiguresIn } from "./send-back-review-figures.js";
import { MODEL_PRICES } from "./writer-prices.js";

vi.mock("./review-rounds.js");
vi.mock("./review-rounds-split.js");
vi.mock("./send-back-tiers.js");
vi.mock("./send-back-tiers-split.js");

const WINDOW: Span = [0, 1000];
const SPLIT_AT = new Date("2026-11-16T00:00:00Z");
const EVENTS: LedgerEvent[] = [];
const ROUNDS: ReviewRounds = {
  tiers: {},
  unlinked: {
    mergedChanges: 4,
    failedReviewRounds: 1,
    reviewedChanges: 2,
    reviewCoverage: 0.5,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sendBackTiersIn).mockReturnValue(NO_SEND_BACK_TIERS);
  vi.mocked(sendBackTiersSplitIn).mockReturnValue({});
  vi.mocked(reviewRoundsIn).mockReturnValue(ROUNDS);
  vi.mocked(reviewRoundsSplitIn).mockReturnValue({});
});

describe("sendBackAndReviewFiguresIn: the send-backs and the review rounds per writer tier (#1045, #1050)", () => {
  it("reads both over the same events and window, for the priced tiers, the send-backs against the categorised minimum", () => {
    const figures = sendBackAndReviewFiguresIn(EVENTS, WINDOW, undefined, 7);

    expect(figures.sendBackTiers).toBe(NO_SEND_BACK_TIERS);
    expect(figures.reviewRounds).toBe(ROUNDS);
    expect(sendBackTiersIn).toHaveBeenCalledWith(
      EVENTS,
      WINDOW,
      Object.keys(MODEL_PRICES),
      7,
    );
    expect(reviewRoundsIn).toHaveBeenCalledWith(
      EVENTS,
      WINDOW,
      Object.keys(MODEL_PRICES),
    );
  });

  it("has neither split key without a split date, so the figures keep the keys they had", () => {
    const figures = sendBackAndReviewFiguresIn(EVENTS, WINDOW, undefined, 7);

    expect(Object.keys(figures)).toEqual(["sendBackTiers", "reviewRounds"]);
    expect(sendBackTiersSplitIn).toHaveBeenCalledWith(
      EVENTS,
      WINDOW,
      undefined,
      7,
    );
    expect(reviewRoundsSplitIn).toHaveBeenCalledWith(EVENTS, WINDOW, undefined);
  });

  it("carries each split right after the figure it splits when given a split date", () => {
    const sendBackTiersSplit = {
      at: SPLIT_AT.toISOString(),
      before: NO_SEND_BACK_TIERS,
      after: NO_SEND_BACK_TIERS,
    };
    const reviewRoundsSplit = {
      at: SPLIT_AT.toISOString(),
      before: ROUNDS,
      after: ROUNDS,
    };
    vi.mocked(sendBackTiersSplitIn).mockReturnValue({ sendBackTiersSplit });
    vi.mocked(reviewRoundsSplitIn).mockReturnValue({ reviewRoundsSplit });

    const figures = sendBackAndReviewFiguresIn(EVENTS, WINDOW, SPLIT_AT, 7);

    expect(Object.keys(figures)).toEqual([
      "sendBackTiers",
      "sendBackTiersSplit",
      "reviewRounds",
      "reviewRoundsSplit",
    ]);
    expect(figures.sendBackTiersSplit).toBe(sendBackTiersSplit);
    expect(figures.reviewRoundsSplit).toBe(reviewRoundsSplit);
    expect(sendBackTiersSplitIn).toHaveBeenCalledWith(
      EVENTS,
      WINDOW,
      SPLIT_AT,
      7,
    );
    expect(reviewRoundsSplitIn).toHaveBeenCalledWith(EVENTS, WINDOW, SPLIT_AT);
  });
});
