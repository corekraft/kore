// Send-backs per merged change over a window, with the same figure over the trailing
// days before it (#830, parent #808). A send-back counts once per PR head, and a
// merged change is a pr.merged event in the span, so the figure is read every window.

import type { LedgerEvent } from "../ledger/index.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import {
  DEFAULT_MERGED_TRAILING_DAYS,
  mergedIn,
  trailingBefore,
} from "./merged-span.js";
import { sendBacksInRange } from "./send-back-categories.js";
import type { Span } from "./scope.js";

/** One figure: send-backs and merged changes in a span, or insufficient when the span has too few merged changes. */
export type SendBacksFigure =
  | {
      status: "ok";
      /** Send-backs in the span, each PR head counted once. */
      sendBacks: number;
      merged: number;
      /** Send-backs over merged changes, to four places. */
      perMerged: number;
    }
  | {
      status: "insufficient merged changes";
      merged: number;
      /** The minimum merged changes a span needs before its figure is read. */
      needed: number;
    };

export interface SendBacksPerMergedChange {
  /** The trailing days the average covers, before the window (or before as-of when the window has no start). */
  trailingDays: number;
  /** The fewest merged changes a span needs before its figure is read. */
  minMergedChanges: number;
  current: SendBacksFigure;
  /** The same figure over the trailing days; its perMerged is the trailing average. */
  trailingAverage: SendBacksFigure;
}

export interface MergedSendBacksOptions {
  trailingDays: number;
  minMergedChanges: number;
  /** Where the trailing days end when the window has no start. */
  asOf: Date;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** The figure for one span, insufficient below the minimum merged changes. */
function figureIn(
  events: LedgerEvent[],
  span: Span,
  minMergedChanges: number,
): SendBacksFigure {
  const merged = mergedIn(events, span);
  if (merged < minMergedChanges) {
    return {
      status: "insufficient merged changes",
      merged,
      needed: minMergedChanges,
    };
  }
  const sendBacks = sendBacksInRange(events, span);
  return {
    status: "ok",
    sendBacks,
    merged,
    perMerged: round(sendBacks / merged),
  };
}

/**
 * Send-backs per merged change over the window, with the same figure over the
 * trailing days before it. A span with too few merged changes gives no value, never
 * a zero.
 */
export function sendBacksPerMergedChange(
  events: LedgerEvent[],
  window: Span,
  { trailingDays, minMergedChanges, asOf }: MergedSendBacksOptions,
): SendBacksPerMergedChange {
  return {
    trailingDays,
    minMergedChanges,
    current: figureIn(events, window, minMergedChanges),
    trailingAverage: figureIn(
      events,
      trailingBefore(window, trailingDays, asOf),
      minMergedChanges,
    ),
  };
}

/**
 * Send-backs per merged change over the window, read against the minimum merged
 * changes the cost settings give (the placeholder when they leave it out).
 */
export function mergedChangeSendBacks(
  events: LedgerEvent[],
  window: Span,
  { asOf, cost = {} }: { asOf: Date; cost?: Partial<CostOptions> },
): SendBacksPerMergedChange {
  return sendBacksPerMergedChange(events, window, {
    trailingDays: DEFAULT_MERGED_TRAILING_DAYS,
    minMergedChanges: { ...DEFAULT_COST, ...cost }.minMergedChanges,
    asOf,
  });
}
