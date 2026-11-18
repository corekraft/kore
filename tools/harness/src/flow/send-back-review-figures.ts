// The figures the flow report reads per writer tier from the judge's send-backs and the principles
// review (#1045, #1050): the send-backs by category with rework, and the failed review rounds beside
// rework with the review coverage, each with its split at a date (#1047). One entry for the writer
// figures to call, so they depend on one module for the two.

import type { LedgerEvent } from "../ledger/index.js";
import { reviewRoundsIn, type ReviewRounds } from "./review-rounds.js";
import {
  reviewRoundsSplitIn,
  type ReviewRoundsSplit,
} from "./review-rounds-split.js";
import type { Span } from "./scope.js";
import { sendBackTiersIn, type SendBackTiers } from "./send-back-tiers.js";
import {
  sendBackTiersSplitIn,
  type SendBackTiersSplit,
} from "./send-back-tiers-split.js";
import { MODEL_PRICES } from "./writer-prices.js";

export interface SendBackAndReviewFigures
  extends SendBackTiersSplit, ReviewRoundsSplit {
  sendBackTiers: SendBackTiers;
  /** The failed review rounds beside rework, and the review coverage, per writer tier (#1050). */
  reviewRounds: ReviewRounds;
}

/**
 * The send-backs per writer tier (against the categorised send-back minimum) and the review rounds
 * per writer tier over the window, each followed by its split on the two sides of the split date
 * when there is one; neither split key is present without a date.
 */
export function sendBackAndReviewFiguresIn(
  events: LedgerEvent[],
  window: Span,
  splitAt: Date | undefined,
  minCategorised: number,
): SendBackAndReviewFigures {
  const tiers = Object.keys(MODEL_PRICES);
  return {
    sendBackTiers: sendBackTiersIn(events, window, tiers, minCategorised),
    ...sendBackTiersSplitIn(events, window, splitAt, minCategorised),
    reviewRounds: reviewRoundsIn(events, window, tiers),
    ...reviewRoundsSplitIn(events, window, splitAt),
  };
}
