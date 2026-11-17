// The advisor's quality (ADR 0120): decisions overturned by the owner over decisions made, in
// the range. Above the refuting share the advisor does worse than taking the recommendation.
import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/**
 * The share of decisions the owner overturns above which the advisor is refuted. A placeholder
 * from ADR 0120, which says the figure is set by its first window of overturn data.
 */
export const REFUTING_SHARE = 0.07;

export interface AdvisorQuality {
  /** decision.made events in the range. */
  made: number;
  /** advisor.overturned events in the range. */
  overturned: number;
  /** Overturned over made, to four places; null when no decision was made in the range, never zero. */
  perMade: number | null;
  /** The share the figure is judged against. */
  refutingShare: number;
  /** The figure is above the refuting share. */
  refuted: boolean;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** Decisions made and overturned in the window, and the share overturned. */
export function advisorQuality(
  events: LedgerEvent[],
  window: Span,
): AdvisorQuality {
  const inSpan = events.filter((e) => inWindow(window, time(e)));
  const made = inSpan.filter((e) => e.kind === "decision.made").length;
  const overturned = inSpan.filter(
    (e) => e.kind === "advisor.overturned",
  ).length;
  const perMade = made === 0 ? null : round(overturned / made);
  return {
    made,
    overturned,
    perMade,
    refutingShare: REFUTING_SHARE,
    refuted: perMade !== null && perMade > REFUTING_SHARE,
  };
}
