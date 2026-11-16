// Lead time per merged change over a window, with the same median over the trailing
// days before it (#830, parent #808). A merged change's lead time runs from its pull
// request's opening to its merge. The opening is the ledger's pr.opened event; when
// the ledger lacks one, the merge carries the PR's own opening time (openedAt).

import type { LedgerEvent } from "../ledger/index.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import { time } from "./github-waits.js";
import {
  DEFAULT_MERGED_TRAILING_DAYS,
  mergedIn,
  trailingBefore,
} from "./merged-span.js";
import { inWindow, type Span } from "./scope.js";
import { median } from "./wip.js";

/**
 * One figure: the median lead time of the merged changes in a span, or insufficient
 * when fewer than the minimum have a measured lead time.
 */
export type LeadTimeFigure =
  | {
      status: "ok";
      /** Merged changes in the span, measured or not. */
      merged: number;
      /** Merged changes whose opening time is known. */
      measured: number;
      /** The median lead time, in whole seconds. */
      medianSeconds: number;
    }
  | {
      status: "insufficient merged changes";
      merged: number;
      measured: number;
      /** The fewest measured merged changes the median needs (at least one). */
      needed: number;
    };

export interface LeadTimePerMergedChange {
  /** The trailing days the average covers, before the window (or before as-of when the window has no start). */
  trailingDays: number;
  /** The fewest measured merged changes a span needs before its median is read. */
  minMergedChanges: number;
  current: LeadTimeFigure;
  /** The same figure over the trailing days. */
  trailingAverage: LeadTimeFigure;
}

export interface MergedLeadTimeOptions {
  trailingDays: number;
  minMergedChanges: number;
  /** Where the trailing days end when the window has no start. */
  asOf: Date;
}

/** The earliest pr.opened time of each PR number in the ledger. */
function openingsOf(events: LedgerEvent[]): Map<number, number> {
  const opened = new Map<number, number>();
  for (const e of events) {
    if (e.kind !== "pr.opened" || e.number === undefined) {
      continue;
    }
    const at = time(e);
    const seen = opened.get(e.number);
    if (seen === undefined || at < seen) {
      opened.set(e.number, at);
    }
  }
  return opened;
}

/**
 * The seconds from a merge's pull request opening to the merge: the ledger's opening
 * event, else the merge's own openedAt; undefined when neither is known.
 */
function leadSeconds(
  merged: LedgerEvent,
  openings: Map<number, number>,
): number | undefined {
  const opened =
    (merged.number === undefined ? undefined : openings.get(merged.number)) ??
    (merged.openedAt === undefined ? undefined : Date.parse(merged.openedAt));
  return opened === undefined ? undefined : (time(merged) - opened) / 1000;
}

/** The figure for one span, insufficient below the minimum measured merged changes. */
function figureIn(
  events: LedgerEvent[],
  span: Span,
  minMergedChanges: number,
): LeadTimeFigure {
  const openings = openingsOf(events);
  const seconds = events
    .filter((e) => e.kind === "pr.merged" && inWindow(span, time(e)))
    .map((e) => leadSeconds(e, openings))
    .filter((s): s is number => s !== undefined);
  const merged = mergedIn(events, span);
  const needed = Math.max(minMergedChanges, 1);
  const medianSeconds = median(seconds);
  if (medianSeconds === null || seconds.length < needed) {
    return {
      status: "insufficient merged changes",
      merged,
      measured: seconds.length,
      needed,
    };
  }
  return {
    status: "ok",
    merged,
    measured: seconds.length,
    medianSeconds: Math.round(medianSeconds),
  };
}

/**
 * Lead time per merged change over the window, with the same median over the
 * trailing days before it. A span with too few measured merged changes gives no
 * value, never a zero.
 */
export function leadTimePerMergedChange(
  events: LedgerEvent[],
  window: Span,
  { trailingDays, minMergedChanges, asOf }: MergedLeadTimeOptions,
): LeadTimePerMergedChange {
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
 * Lead time per merged change over the window, read against the minimum merged
 * changes the cost settings give (the placeholder when they leave it out).
 */
export function mergedChangeLeadTime(
  events: LedgerEvent[],
  window: Span,
  { asOf, cost = {} }: { asOf: Date; cost?: Partial<CostOptions> },
): LeadTimePerMergedChange {
  return leadTimePerMergedChange(events, window, {
    trailingDays: DEFAULT_MERGED_TRAILING_DAYS,
    minMergedChanges: { ...DEFAULT_COST, ...cost }.minMergedChanges,
    asOf,
  });
}
