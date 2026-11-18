// The writer figures the flow report reads over one window: the writer cost per merged change by
// tier (writer-cost.ts) and the Haiku and Sonnet arms (writer-arms.ts), both read against the same
// minimum merged changes from the cost settings (#1012).

import type { LedgerEvent } from "../ledger/index.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import type { Span } from "./scope.js";
import { writerArmsIn, type WriterArms } from "./writer-arms.js";
import { mergedChangeWriterCost, type WriterCost } from "./writer-cost.js";
import { MODEL_PRICES } from "./writer-prices.js";
import { sendBackTiersIn, type SendBackTiers } from "./send-back-tiers.js";
import {
  sendBackTiersSplitIn,
  type SendBackTiersSplit,
} from "./send-back-tiers-split.js";

export interface WriterFigures extends SendBackTiersSplit {
  writerCost: WriterCost;
  writerArms: WriterArms;
  sendBackTiers: SendBackTiers;
}

/**
 * The writer cost, the arms and the send-backs per writer tier over the window, the first two read
 * against the cost settings' minimum merged changes (#1012, #1045); and, given a split date, the
 * same send-backs read on each side of it (#1047).
 */
export function writerFiguresIn(
  events: LedgerEvent[],
  window: Span,
  options: {
    asOf: Date;
    cost?: Partial<CostOptions>;
    windowEffort?: string;
    /** Splits the send-backs per writer tier at this date (#1047). */
    splitAt?: Date;
  },
): WriterFigures {
  return {
    writerCost: mergedChangeWriterCost(events, window, options),
    writerArms: writerArmsIn(events, window, MODEL_PRICES, {
      minMergedChanges: { ...DEFAULT_COST, ...options.cost }.minMergedChanges,
      ...(options.windowEffort === undefined
        ? {}
        : { windowEffort: options.windowEffort }),
    }),
    sendBackTiers: sendBackTiersIn(events, window, Object.keys(MODEL_PRICES)),
    ...sendBackTiersSplitIn(events, window, options.splitAt),
  };
}
