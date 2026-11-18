// The flow report's failed review rounds and review coverage per writer tier split at a date (#1050,
// #1047): the same figures as reviewRounds, read over the time before the date and the time on or
// after it.

import type { LedgerEvent } from "../ledger/index.js";
import { splitFiguresAt, type SplitFigures } from "./date-split.js";
import { reviewRoundsIn, type ReviewRounds } from "./review-rounds.js";
import type { Span } from "./scope.js";
import { MODEL_PRICES } from "./writer-prices.js";

/** The report's `reviewRoundsSplit` key: present only when the report is given a split date. */
export interface ReviewRoundsSplit {
  reviewRoundsSplit?: SplitFigures<ReviewRounds>;
}

/**
 * The review rounds over each side of the split date, under `reviewRoundsSplit`; nothing without a
 * date, so a report with no split carries exactly the keys it would otherwise. A change merged at
 * the date is on the after side (date-split.ts). Merged changes are placed by their merge time and
 * rounds and rework by the time each was recorded, as in the unsplit figures.
 */
export function reviewRoundsSplitIn(
  events: LedgerEvent[],
  span: Span,
  splitAt: Date | undefined,
): ReviewRoundsSplit {
  if (splitAt === undefined) {
    return {};
  }
  return {
    reviewRoundsSplit: splitFiguresAt(span, splitAt, (side) =>
      reviewRoundsIn(events, side, Object.keys(MODEL_PRICES)),
    ),
  };
}
