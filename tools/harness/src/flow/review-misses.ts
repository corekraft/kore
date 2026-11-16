// Passed reviews later sent back for a rule break, and reviews that found a
// violation (#851, parent #817): figures from the review.run events the review
// run writes, and the send-back categories the judge records.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

export const DEFAULT_REVIEW_DAYS = 7;
const DAY_MS = 86_400_000;

/** A review.run that posted or left unchanged a verdict: `posted:<head>` or `unchanged:<head>`. */
const VERDICT = /^(?:posted|unchanged):([0-9a-f]{7,40})$/;

export interface ReviewMisses {
  /** The trailing days the averages cover, before the window (or before as-of when the window has no start). */
  trailingDays: number;
  /** Reviews with a recorded verdict in the window, one per PR head. */
  reviews: number;
  /** Reviews in the window from before the findings count was recorded; they are in no figure. */
  unrecorded: number;
  /** Clean reviews whose PR was later sent back for a rule break. */
  passedRuleBreak: {
    count: number;
    /** count over reviews; null when there are none, never zero. */
    ratio: number | null;
    /** The same ratio over the trailing days; null when there were no reviews there, the first window's baseline. */
    trailingAverage: number | null;
    /** The ratio is above the trailing average. */
    worsened: boolean;
  };
  /** Reviews that found at least one violation. */
  foundViolation: {
    count: number;
    /** count over reviews; null when there are none. */
    share: number | null;
    /** The same share over the trailing days; null when there were no reviews there. */
    trailingAverage: number | null;
  };
}

export interface ReviewMissOptions {
  /** Trailing days for the averages; DEFAULT_REVIEW_DAYS when left out. */
  trailingDays?: number;
  /** Where the trailing days end when the window has no start; and the latest a send-back counts. */
  asOf: Date;
}

interface Review {
  number: number;
  /** The head the verdict names; a PR head counts once. */
  head: string;
  at: number;
  /** Undefined for a review from before the findings count was recorded. */
  findings: number | undefined;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** One review per PR head: the first verdict recorded for it. */
function reviewsOf(events: LedgerEvent[]): Review[] {
  const first = new Map<string, Review>();
  for (const e of events) {
    const head = VERDICT.exec(e.label ?? "")?.[1];
    if (
      e.kind !== "review.run" ||
      e.number === undefined ||
      head === undefined
    ) {
      continue;
    }
    const key = `${e.number}\0${head}`;
    const at = time(e);
    const prior = first.get(key);
    if (prior === undefined || at < prior.at) {
      first.set(key, { number: e.number, head, at, findings: e.findings });
    }
  }
  return [...first.values()];
}

interface Tally {
  reviews: number;
  unrecorded: number;
  found: number;
  passedRuleBreak: number;
}

/**
 * Counts the reviews in a span. A clean review is passed-then-sent-back when a
 * rule-break send-back on its PR comes after it, and not after as-of.
 */
function tally(
  reviews: Review[],
  span: Span,
  events: LedgerEvent[],
  asOf: number,
): Tally {
  const ruleBreaks = events.filter(
    (e) => e.kind === "send-back" && e.category === "rule-break",
  );
  const inSpan = reviews.filter((r) => inWindow(span, r.at));
  const recorded = inSpan.filter((r) => r.findings !== undefined);
  const passed = recorded.filter((r) => r.findings === 0);
  return {
    reviews: recorded.length,
    unrecorded: inSpan.length - recorded.length,
    found: recorded.filter((r) => (r.findings ?? 0) > 0).length,
    passedRuleBreak: passed.filter((r) =>
      ruleBreaks.some(
        (e) => e.number === r.number && time(e) > r.at && time(e) <= asOf,
      ),
    ).length,
  };
}

/**
 * Passed reviews later sent back for a rule break, and reviews that found a
 * violation, over the window, each with the same figure over the trailing days
 * before it. The trailing days end where the window starts, or at as-of when
 * the window has no start.
 */
export function reviewMisses(
  events: LedgerEvent[],
  window: Span,
  { trailingDays = DEFAULT_REVIEW_DAYS, asOf }: ReviewMissOptions,
): ReviewMisses {
  const reviews = reviewsOf(events);
  const end = Number.isFinite(window[0]) ? window[0] : asOf.getTime();
  const trailing: Span = [end - trailingDays * DAY_MS, end];
  const now = tally(reviews, window, events, asOf.getTime());
  const before = tally(reviews, trailing, events, asOf.getTime());
  const ratio = (t: Tally) =>
    t.reviews === 0 ? null : round(t.passedRuleBreak / t.reviews);
  const share = (t: Tally) =>
    t.reviews === 0 ? null : round(t.found / t.reviews);
  const current = ratio(now);
  const average = ratio(before);
  return {
    trailingDays,
    reviews: now.reviews,
    unrecorded: now.unrecorded,
    passedRuleBreak: {
      count: now.passedRuleBreak,
      ratio: current,
      trailingAverage: average,
      worsened: current !== null && average !== null && current > average,
    },
    foundViolation: {
      count: now.found,
      share: share(now),
      trailingAverage: share(before),
    },
  };
}
