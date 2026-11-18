// The send-back lines of the flow report: judge send-backs by category, per PR head and per merged
// change (#830, #1045), and per writer tier with an unlinked row (#1045). Split out of flow-lines.ts
// to keep that file under its line limit; flow-lines.ts re-exports sendBackCategoryLines.

import { SEND_BACK_CATEGORIES } from "../ledger/index.js";
import {
  CATEGORY_REQUIRED_FROM,
  type CategoryCounts,
  type FlowReport,
  type SendBackTiers,
} from "../flow/index.js";
import { changes } from "./flow-lines-writer-cost.js";

/** How the share of other reads: no share, the share alone, or the share with why it is not read or what it flags. */
function shareText(counts: CategoryCounts): string {
  if (counts.otherShare === null) {
    return "no categorised send-backs";
  }
  const share = `other ${Math.round(counts.otherShare * 100)}% of categorised`;
  if (counts.otherReading === "insufficient") {
    return `${share}, insufficient: ${counts.categorised} of ${counts.minCategorised} categorised send-backs needed`;
  }
  return counts.otherReading === "over"
    ? `${share}, over ${Math.round(counts.otherThreshold * 100)}%: the list may need an entry`
    : share;
}

/**
 * One line per scope: every category's count, the legacy count (recorded before the category
 * requirement, so neither uncategorised nor other), the uncategorised and categorised counts, and
 * the share of other among the categorised ones.
 */
function categoryLine(scope: string, counts: CategoryCounts): string {
  const byCategory = SEND_BACK_CATEGORIES.map(
    (c) => `${c} ${counts.byCategory[c]}`,
  ).join(", ");
  const cut = CATEGORY_REQUIRED_FROM.toISOString().slice(0, 10);
  return `Send-backs by category, ${scope}: ${byCategory}; legacy ${counts.legacy} (recorded before ${cut}, when a category became required); uncategorised ${counts.uncategorised}; categorised ${counts.categorised}; ${shareText(counts)}`;
}

/** The send-backs by category, per PR head and per merged change. */
export const sendBackCategoryLines = (
  categories: FlowReport["sendBackCategories"],
) => [
  categoryLine("per PR head", categories.perPrHead),
  categoryLine("per merged change", categories.perMergedChange),
];

/** A tier's rework with the count it is read over, and its rate: not read, never zero, with no merged change. */
function reworkText(row: SendBackTiers["tiers"][string]): string {
  const rate =
    row.reworkPerMergedChange === null
      ? "per merged change not read"
      : `${row.reworkPerMergedChange} per merged change`;
  return `rework ${row.rework} over ${changes(row.mergedChanges)}, ${rate}`;
}

/**
 * The send-backs by category per writer tier, one line per tier in tier order, then the unlinked row
 * (#1045). Each tier line names its merged changes and the rework it is read over; the unlinked row
 * names its merged changes and reads no rework, since its sends have no writer tier.
 */
export function sendBackTierLines(sendBackTiers: SendBackTiers): string[] {
  const tierLines = Object.entries(sendBackTiers.tiers).map(
    ([tier, row]) =>
      `${categoryLine(`writer tier ${tier}, ${changes(row.mergedChanges)}`, row.sendBacks)}; ${reworkText(row)}`,
  );
  const unlinked = `${categoryLine(`unlinked row (${changes(sendBackTiers.unlinked.mergedChanges)} with no writer tier)`, sendBackTiers.unlinked.sendBacks)}; rework not read, no writer tier`;
  return [...tierLines, unlinked];
}
