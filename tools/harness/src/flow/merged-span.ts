// The span arithmetic every per-merged-change figure shares (#830, parent #808): the
// trailing days a figure averages over, and the merged changes in a span.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

export const DAY_MS = 86_400_000;

/** The trailing days a per-merged average covers, the same as the owner questions figure (#859). */
export const DEFAULT_MERGED_TRAILING_DAYS = 7;

/**
 * The trailing days a per-merged average reads: the days before the window, which
 * end where the window starts, or at as-of when the window has no start.
 */
export function trailingBefore(
  window: Span,
  trailingDays: number,
  asOf: Date,
): Span {
  const end = Number.isFinite(window[0]) ? window[0] : asOf.getTime();
  return [end - trailingDays * DAY_MS, end];
}

/** The merged changes (pr.merged events) inside the span. */
export function mergedIn(events: LedgerEvent[], span: Span): number {
  return events.filter((e) => e.kind === "pr.merged" && inWindow(span, time(e)))
    .length;
}
