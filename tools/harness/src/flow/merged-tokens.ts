// Tokens per merged change over a window, with the same figure over the trailing
// days before it (#829, parent #808). Figures are per merged change, not per idea,
// so they are read every window and not only when an idea completes.

import type { LedgerEvent } from "../ledger/index.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

const DAY_MS = 86_400_000;

/** The trailing days the per-merged average covers, the same as the owner questions figure (#859). */
export const DEFAULT_MERGED_TRAILING_DAYS = 7;

/** One figure: tokens and merged changes in a span, or insufficient when the span has too few merged changes. */
export type MergedFigure =
  | {
      status: "ok";
      /** Tokens spent in the span, across every session the ledger holds. */
      tokens: number;
      merged: number;
      /** Tokens over merged changes, to four places. */
      perMerged: number;
    }
  | {
      status: "insufficient merged changes";
      merged: number;
      /** The minimum merged changes a span needs before its figure is read. */
      needed: number;
    };

export interface TokensPerMergedChange {
  /** The trailing days the average covers, before the window (or before as-of when the window has no start). */
  trailingDays: number;
  /** The fewest merged changes a span needs before its figure is read. */
  minMergedChanges: number;
  current: MergedFigure;
  /** The same figure over the trailing days; its perMerged is the trailing average. */
  trailingAverage: MergedFigure;
}

export interface MergedTokensOptions {
  trailingDays: number;
  minMergedChanges: number;
  /** Where the trailing days end when the window has no start. */
  asOf: Date;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * The latest cumulative token count per session at or before `at`. A token.usage
 * event is a session's total so far, so a session's spend over a span is its count
 * at the span's end less its count at the span's start.
 */
function countsBefore(events: LedgerEvent[], at: number): Map<string, number> {
  const latest = new Map<string, { at: number; tokens: number }>();
  for (const event of events) {
    if (event.kind !== "token.usage" || event.tokens === undefined) {
      continue;
    }
    const t = time(event);
    if (t >= at) {
      continue;
    }
    const key = event.session ?? event.pane ?? event.id;
    const seen = latest.get(key);
    if (seen === undefined || t >= seen.at) {
      latest.set(key, { at: t, tokens: event.tokens });
    }
  }
  return new Map([...latest].map(([key, v]) => [key, v.tokens]));
}

/** Tokens spent in the span, summed over every session that has a reading by its end. */
function tokensIn(events: LedgerEvent[], span: Span): number {
  const end = countsBefore(events, span[1]);
  const start = countsBefore(events, span[0]);
  let total = 0;
  for (const [session, tokens] of end) {
    total += tokens - (start.get(session) ?? 0);
  }
  return total;
}

/** The figure for one span, insufficient below the minimum merged changes. */
function figureIn(
  events: LedgerEvent[],
  span: Span,
  minMergedChanges: number,
): MergedFigure {
  const merged = events.filter(
    (e) => e.kind === "pr.merged" && inWindow(span, time(e)),
  ).length;
  if (merged < minMergedChanges) {
    return {
      status: "insufficient merged changes",
      merged,
      needed: minMergedChanges,
    };
  }
  const tokens = tokensIn(events, span);
  return {
    status: "ok",
    tokens,
    merged,
    perMerged: round(tokens / merged),
  };
}

/**
 * Tokens per merged change over the window, with the same figure over the
 * trailing days before it. The trailing days end where the window starts, or at
 * as-of when the window has no start. A span with too few merged changes gives
 * no value, never a zero.
 */
export function tokensPerMergedChange(
  events: LedgerEvent[],
  window: Span,
  { trailingDays, minMergedChanges, asOf }: MergedTokensOptions,
): TokensPerMergedChange {
  const end = Number.isFinite(window[0]) ? window[0] : asOf.getTime();
  const trailing: Span = [end - trailingDays * DAY_MS, end];
  return {
    trailingDays,
    minMergedChanges,
    current: figureIn(events, window, minMergedChanges),
    trailingAverage: figureIn(events, trailing, minMergedChanges),
  };
}

/**
 * Tokens per merged change over the window, read against the minimum merged
 * changes the cost settings give (the placeholder when they leave it out).
 */
export function mergedChangeTokens(
  events: LedgerEvent[],
  window: Span,
  { asOf, cost = {} }: { asOf: Date; cost?: Partial<CostOptions> },
): TokensPerMergedChange {
  return tokensPerMergedChange(events, window, {
    trailingDays: DEFAULT_MERGED_TRAILING_DAYS,
    minMergedChanges: { ...DEFAULT_COST, ...cost }.minMergedChanges,
    asOf,
  });
}
