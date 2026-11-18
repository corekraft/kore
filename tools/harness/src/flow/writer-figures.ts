// The writer figures the flow report reads over one window: the writer cost per merged change by
// tier (writer-cost.ts) and the Haiku and Sonnet arms (writer-arms.ts), both read against the same
// minimum merged changes from the cost settings (#1012).

import type { LedgerEvent } from "../ledger/index.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import type { Span } from "./scope.js";
import { writerArmsIn, type WriterArms } from "./writer-arms.js";
import { mergedChangeWriterCost, type WriterCost } from "./writer-cost.js";
import { MODEL_PRICES } from "./writer-prices.js";

export interface WriterFigures {
  writerCost: WriterCost;
  writerArms: WriterArms;
}

/** The writer cost and the arms over the window, each read against the cost settings' minimum merged changes. */
export function writerFiguresIn(
  events: LedgerEvent[],
  window: Span,
  options: {
    asOf: Date;
    cost?: Partial<CostOptions>;
    windowEffort?: string;
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
  };
}
