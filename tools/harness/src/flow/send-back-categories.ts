import {
  SEND_BACK_CATEGORIES,
  type LedgerEvent,
  type SendBackCategory,
} from "../ledger/index.js";
import { closedIdeas } from "./cost.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";
import {
  legacySpan,
  otherShareOf,
  type OtherShare,
} from "./send-back-share.js";

/**
 * The share of categorised send-backs on `other` above which the list is
 * probably missing an entry. A placeholder until the owner sets it.
 */
export const OTHER_SHARE_THRESHOLD = 0.1;

/**
 * Send-backs counted by category, with the share of `other` among the categorised ones. A send-back
 * recorded before the category requirement is legacy (send-back-share.ts), counted apart from the
 * categorised and the uncategorised.
 */
export interface CategoryCounts extends OtherShare {
  /** Every category, zero when none was sent back. */
  byCategory: Record<SendBackCategory, number>;
  /** Send-backs recorded before the category requirement (2026-11-16); neither uncategorised nor `other`. */
  legacy: number;
  /** Send-backs from after the requirement that carry no category; none is expected. */
  uncategorised: number;
  otherThreshold: number;
}

/** Counts per PR head, and per merged change (the send-backs of ideas that closed in range). */
export interface SendBackCategoryReport {
  perPrHead: CategoryCounts;
  perMergedChange: CategoryCounts;
}

/** The head a send-back's label ends with (`@<sha7>`); a send-back that names none counts on its own. */
const headOf = (e: LedgerEvent): string =>
  /@([0-9a-f]{7,40})$/.exec(e.label ?? "")?.[1] ?? `event:${e.id}`;

/** The send-backs in range counted by category, legacy or uncategorised, each once per PR head. */
function countSendBacks(events: LedgerEvent[], window: Span) {
  const byCategory = Object.fromEntries(
    SEND_BACK_CATEGORIES.map((c) => [c, 0]),
  ) as Record<SendBackCategory, number>;
  const legacyWindow = legacySpan(window);
  const seen = new Set<string>();
  let legacy = 0;
  let uncategorised = 0;
  for (const e of events) {
    if (e.kind !== "send-back" || !inWindow(window, time(e))) {
      continue;
    }
    const key = `${e.number}\0${headOf(e)}\0${e.category ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (inWindow(legacyWindow, time(e))) {
      legacy += 1;
    } else if (e.category === undefined) {
      uncategorised += 1;
    } else {
      byCategory[e.category] += 1;
    }
  }
  return { byCategory, legacy, uncategorised };
}

/**
 * Send-backs in range by category. A category is counted once per PR head, so a
 * rerun at the same head counts once; an event of another kind is not a send-back.
 * The share of `other` is read from the categorised send-backs only, and reads
 * insufficient below `minCategorised` of them (#1094).
 */
export function sendBackCategories(
  events: LedgerEvent[],
  window: Span,
  minCategorised: number,
): CategoryCounts {
  const { byCategory, legacy, uncategorised } = countSendBacks(events, window);
  return {
    byCategory,
    legacy,
    uncategorised,
    otherThreshold: OTHER_SHARE_THRESHOLD,
    ...otherShareOf(byCategory, minCategorised, OTHER_SHARE_THRESHOLD),
  };
}

/**
 * The send-backs in range, each PR head once whatever its category and legacy ones
 * included: the count a per-merged figure divides by merged changes (#830).
 */
export function sendBacksInRange(events: LedgerEvent[], window: Span): number {
  const counts = countSendBacks(events, window);
  return (
    counts.legacy +
    counts.uncategorised +
    Object.values(counts.byCategory).reduce((sum, n) => sum + n, 0)
  );
}

/** Send-backs per PR head over every event in range, and per merged change over the ideas that closed in range. */
export function categoryReport(
  named: LedgerEvent[],
  byIdea: Map<string, LedgerEvent[]>,
  window: Span,
  minCategorised: number,
): SendBackCategoryReport {
  const merged = closedIdeas(byIdea, window).flatMap((c) => c.own);
  return {
    perPrHead: sendBackCategories(named, window, minCategorised),
    perMergedChange: sendBackCategories(merged, window, minCategorised),
  };
}
