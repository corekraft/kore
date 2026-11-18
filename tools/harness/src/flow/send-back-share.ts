// The share of categorised send-backs that are `other`, and the cut before which send-backs are
// legacy (#1094, spec #1088). The judge's send-back command has required a category since
// 2026-11-16 (#884); a send-back recorded before it has none, and is reported as legacy, apart from
// the categorised ones the share is read from. Old send-backs are left out, not back-filled.

import type { SendBackCategory } from "../ledger/index.js";
import { splitSpanAt } from "./date-split.js";
import type { Span } from "./scope.js";

/** The moment the send-back command began to require a category (#884); a send-back before it is legacy. */
export const CATEGORY_REQUIRED_FROM = new Date("2026-11-16T00:00:00.000Z");

/** What the share of `other` reads: below the minimum sample it is insufficient, never over or within. */
export type OtherReading = "insufficient" | "over" | "within";

/** The categorised send-backs and the share of them on `other`, with how it is read. */
export interface OtherShare {
  /** Send-backs with a category: the denominator of the share. */
  categorised: number;
  /** `other` over the categorised send-backs; null when there are none. */
  otherShare: number | null;
  /** The fewest categorised send-backs the share needs before it is read over or within. */
  minCategorised: number;
  otherReading: OtherReading;
  /** True only when the reading is `over`; never true below the minimum. */
  otherOverThreshold: boolean;
}

/** The part of the window before the category requirement; its send-backs are legacy. */
export const legacySpan = (window: Span): Span =>
  splitSpanAt(window, CATEGORY_REQUIRED_FROM).before;

/**
 * The share of `other` among the categorised send-backs. Below `minCategorised` categorised
 * send-backs the reading is insufficient: the share is still given, but it is neither over nor
 * within the threshold. At the minimum or above, a share past the threshold is over.
 */
export function otherShareOf(
  byCategory: Record<SendBackCategory, number>,
  minCategorised: number,
  threshold: number,
): OtherShare {
  const categorised = Object.values(byCategory).reduce((sum, n) => sum + n, 0);
  const otherShare = categorised === 0 ? null : byCategory.other / categorised;
  let otherReading: OtherReading = "insufficient";
  if (otherShare !== null && categorised >= minCategorised) {
    otherReading = otherShare > threshold ? "over" : "within";
  }
  return {
    categorised,
    otherShare,
    minCategorised,
    otherReading,
    otherOverThreshold: otherReading === "over",
  };
}
