// The date cut (#1047, spec #1024): a report span split at a date into the time before it and the
// time on or after it, so a reader compares the figures before and after a fix. Figure code takes
// the two sides as plain spans, so every figure that reads a span can be read on either side.

import type { Span } from "./scope.js";

/** A span cut at a date: `before` runs up to the date, `after` from it. */
export interface SplitSpan {
  before: Span;
  after: Span;
}

/** Figures read on each side of a date, with the date as an ISO time. */
export interface SplitFigures<T> {
  at: string;
  before: T;
  after: T;
}

/**
 * The span cut at a date. A span includes its start and not its end (like `ledger list` and
 * --since and --until), so the moment of the date itself falls on the after side only. A date
 * outside the span leaves one side empty and the other the whole span.
 */
export function splitSpanAt(span: Span, at: Date): SplitSpan {
  const [from, to] = span;
  const cut = Math.min(Math.max(at.getTime(), from), to);
  return { before: [from, cut], after: [cut, to] };
}

/** The figures read over the span's before side and its after side, with the date named. */
export function splitFiguresAt<T>(
  span: Span,
  at: Date,
  figures: (side: Span) => T,
): SplitFigures<T> {
  const { before, after } = splitSpanAt(span, at);
  return {
    at: at.toISOString(),
    before: figures(before),
    after: figures(after),
  };
}
