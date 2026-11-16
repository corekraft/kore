import {
  SEND_BACK_CATEGORIES,
  type LedgerEvent,
  type SendBackCategory,
} from "../ledger/index.js";
import { closedIdeas } from "./cost.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/**
 * The share of categorised send-backs on `other` above which the list is
 * probably missing an entry. A placeholder until the owner sets it.
 */
export const OTHER_SHARE_THRESHOLD = 0.1;

/** Send-backs counted by category, with the share of `other` among the categorised ones. */
export interface CategoryCounts {
  /** Every category, zero when none was sent back. */
  byCategory: Record<SendBackCategory, number>;
  /** Send-backs recorded before categories existed; they are not `other`. */
  uncategorised: number;
  /** `other` over the categorised send-backs; null when there are none. */
  otherShare: number | null;
  otherThreshold: number;
  otherOverThreshold: boolean;
}

/** Counts per PR head, and per merged change (the send-backs of ideas that closed in range). */
export interface SendBackCategoryReport {
  perPrHead: CategoryCounts;
  perMergedChange: CategoryCounts;
}

/** The head a send-back's label ends with (`@<sha7>`); a send-back that names none counts on its own. */
const headOf = (e: LedgerEvent): string =>
  /@([0-9a-f]{7,40})$/.exec(e.label ?? "")?.[1] ?? `event:${e.id}`;

/**
 * Send-backs in range by category. A category is counted once per PR head, so a
 * rerun at the same head counts once; an event of another kind is not a send-back.
 */
export function sendBackCategories(
  events: LedgerEvent[],
  window: Span,
): CategoryCounts {
  const byCategory = Object.fromEntries(
    SEND_BACK_CATEGORIES.map((c) => [c, 0]),
  ) as Record<SendBackCategory, number>;
  const seen = new Set<string>();
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
    if (e.category === undefined) {
      uncategorised += 1;
    } else {
      byCategory[e.category] += 1;
    }
  }
  const categorised = Object.values(byCategory).reduce((sum, n) => sum + n, 0);
  const otherShare = categorised === 0 ? null : byCategory.other / categorised;
  return {
    byCategory,
    uncategorised,
    otherShare,
    otherThreshold: OTHER_SHARE_THRESHOLD,
    otherOverThreshold:
      otherShare !== null && otherShare > OTHER_SHARE_THRESHOLD,
  };
}

/** Send-backs per PR head over every event in range, and per merged change over the ideas that closed in range. */
export function categoryReport(
  named: LedgerEvent[],
  byIdea: Map<string, LedgerEvent[]>,
  window: Span,
): SendBackCategoryReport {
  const merged = closedIdeas(byIdea, window).flatMap((c) => c.own);
  return {
    perPrHead: sendBackCategories(named, window),
    perMergedChange: sendBackCategories(merged, window),
  };
}
