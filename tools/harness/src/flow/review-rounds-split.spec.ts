import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { splitFiguresAt } from "./date-split.js";
import { reviewRoundsIn, type ReviewRounds } from "./review-rounds.js";
import { reviewRoundsSplitIn } from "./review-rounds-split.js";
import type { Span } from "./scope.js";
import { MODEL_PRICES } from "./writer-prices.js";

vi.mock("./date-split.js");
vi.mock("./review-rounds.js");

const SPAN: Span = [0, 1000];
const CUT = new Date("2026-11-16T00:00:00Z");
const EVENTS: LedgerEvent[] = [];

const figures = (mergedChanges: number): ReviewRounds => ({
  tiers: {},
  unlinked: {
    mergedChanges,
    failedReviewRounds: 0,
    reviewedChanges: 0,
    reviewCoverage: null,
  },
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("reviewRoundsSplitIn: the failed review rounds and coverage on each side of a date (#1050)", () => {
  it("adds nothing without a split date, so the report keeps the keys it had", () => {
    expect(reviewRoundsSplitIn(EVENTS, SPAN, undefined)).toEqual({});
    expect(splitFiguresAt).not.toHaveBeenCalled();
    expect(reviewRoundsIn).not.toHaveBeenCalled();
  });

  it("reads the figures over each side of the date and carries both under reviewRoundsSplit", () => {
    const before: Span = [0, 500];
    const after: Span = [500, 1000];
    vi.mocked(splitFiguresAt).mockImplementation((_span, _at, read) => ({
      at: "2026-11-16T00:00:00.000Z",
      before: read(before),
      after: read(after),
    }));
    vi.mocked(reviewRoundsIn).mockImplementation((_events, side) =>
      figures(side === before ? 1 : 2),
    );

    expect(reviewRoundsSplitIn(EVENTS, SPAN, CUT)).toEqual({
      reviewRoundsSplit: {
        at: "2026-11-16T00:00:00.000Z",
        before: figures(1),
        after: figures(2),
      },
    });
    expect(splitFiguresAt).toHaveBeenCalledWith(
      SPAN,
      CUT,
      expect.any(Function),
    );
    expect(reviewRoundsIn).toHaveBeenCalledWith(
      EVENTS,
      before,
      Object.keys(MODEL_PRICES),
    );
    expect(reviewRoundsIn).toHaveBeenCalledWith(
      EVENTS,
      after,
      Object.keys(MODEL_PRICES),
    );
  });
});
