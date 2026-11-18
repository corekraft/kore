// The writer figures the flow report reads over one window: the writer cost per merged change by
// tier (writer-cost.ts) and the Haiku and Sonnet arms (writer-arms.ts), both read against the same
// minimum merged changes from the cost settings (#1012).

import type { LedgerEvent } from "../ledger/index.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import type { Span } from "./scope.js";
import { writerArmsIn, type WriterArms } from "./writer-arms.js";
import { mergedChangeWriterCost, type WriterCost } from "./writer-cost.js";
import { MODEL_PRICES } from "./writer-prices.js";
import {
  reviewViolationFiguresIn,
  type ReviewViolationFigures,
} from "./review-violation-figures.js";
import {
  sendBackAndReviewFiguresIn,
  type SendBackAndReviewFigures,
} from "./send-back-review-figures.js";

export interface WriterFigures
  extends SendBackAndReviewFigures, ReviewViolationFigures {
  writerCost: WriterCost;
  writerArms: WriterArms;
}

/**
 * The writer cost, the arms, the send-backs per writer tier and the review rounds per writer tier
 * over the window, the first two read against the cost settings' minimum merged changes (#1012,
 * #1045, #1050); and, given a split date, the send-backs and the review rounds each read on each
 * side of it (#1047, #1050).
 */
export function writerFiguresIn(
  events: LedgerEvent[],
  window: Span,
  options: {
    asOf: Date;
    cost?: Partial<CostOptions>;
    windowEffort?: string;
    /** Splits the send-backs and the review rounds per writer tier at this date (#1047, #1050). */
    splitAt?: Date;
  },
): WriterFigures {
  const { minCategorisedSendBacks, minMergedChanges } = {
    ...DEFAULT_COST,
    ...options.cost,
  };
  return {
    writerCost: mergedChangeWriterCost(events, window, options),
    writerArms: writerArmsIn(events, window, MODEL_PRICES, {
      minMergedChanges,
      ...(options.windowEffort === undefined
        ? {}
        : { windowEffort: options.windowEffort }),
    }),
    ...sendBackAndReviewFiguresIn(
      events,
      window,
      options.splitAt,
      minCategorisedSendBacks,
    ),
    ...reviewViolationFiguresIn(
      events,
      window,
      options.splitAt,
      minMergedChanges,
    ),
  };
}
