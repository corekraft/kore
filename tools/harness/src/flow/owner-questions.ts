// Owner questions per merged change (#859, parent #820): a figure from the
// owner.asked events a hook writes, which the router never writes.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

export const DEFAULT_QUESTION_DAYS = 7;
const DAY_MS = 86_400_000;

export interface OwnerQuestions {
  /** The trailing days the average covers, before the window (or before as-of when the window has no start). */
  trailingDays: number;
  /** owner.asked events in the window. */
  questions: number;
  /** Merged pull requests in the window. */
  merged: number;
  /** Questions per merged change in the window; null when nothing merged, never zero. */
  perMerged: number | null;
  /** The same ratio over the trailing days; null when nothing merged there. */
  trailingAverage: number | null;
  /** The window's figure is above the trailing average. */
  worsened: boolean;
}

export interface OwnerQuestionOptions {
  trailingDays: number;
  /** Where the trailing days end when the window has no start. */
  asOf: Date;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** Questions and merges whose time falls in the span. */
function countIn(events: LedgerEvent[], span: Span) {
  const inSpan = events.filter((e) => inWindow(span, time(e)));
  return {
    questions: inSpan.filter((e) => e.kind === "owner.asked").length,
    merged: inSpan.filter((e) => e.kind === "pr.merged").length,
  };
}

/**
 * Owner questions per merged change over the window, with the same ratio over
 * the trailing days before it. The trailing days end where the window starts,
 * or at as-of when the window has no start.
 */
export function ownerQuestions(
  events: LedgerEvent[],
  window: Span,
  { trailingDays, asOf }: OwnerQuestionOptions,
): OwnerQuestions {
  const end = Number.isFinite(window[0]) ? window[0] : asOf.getTime();
  const trailing: Span = [end - trailingDays * DAY_MS, end];
  const now = countIn(events, window);
  const before = countIn(events, trailing);
  const perMerged = now.merged === 0 ? null : round(now.questions / now.merged);
  const trailingAverage =
    before.merged === 0 ? null : round(before.questions / before.merged);
  return {
    trailingDays,
    questions: now.questions,
    merged: now.merged,
    perMerged,
    trailingAverage,
    worsened:
      perMerged !== null &&
      trailingAverage !== null &&
      perMerged > trailingAverage,
  };
}
