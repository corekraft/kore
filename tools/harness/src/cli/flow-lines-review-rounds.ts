// The failed review rounds and review coverage per writer tier for the flow report's text (#1050),
// with the same figures on each side of the split date when the report has one (#1047). Failed review
// rounds are printed beside rework under their own name, and every rate is printed with its count.

import type { FlowReport, ReviewRounds } from "../flow/index.js";
import { changes } from "./flow-lines-writer-cost.js";

const TITLE = "Failed review rounds and review coverage";

/** A rate of something per merged change, or why it is not read: never zero with no merged change. */
const perChange = (rate: number | null) =>
  rate === null ? "per merged change not read" : `${rate} per merged change`;

/** The reviewed changes over the merged changes, and the share, or why it is not read. */
function coverageText(
  reviewed: number,
  merged: number,
  coverage: number | null,
): string {
  const share =
    coverage === null ? "not read" : `${Math.round(coverage * 100)}%`;
  return `review coverage ${reviewed} of ${changes(merged)}, ${share}`;
}

/**
 * The failed review rounds and review coverage per writer tier, one line per tier in tier order, then
 * the unlinked row. A tier line names its failed review rounds and its rework, each over the merged
 * changes it is read over; the unlinked row names its merged changes and reads no rework, since its
 * sends have no writer tier.
 */
export function reviewRoundLines({ tiers, unlinked }: ReviewRounds): string[] {
  const tierLines = Object.entries(tiers).map(
    ([tier, row]) =>
      `${TITLE}, writer tier ${tier}, ${changes(row.mergedChanges)}: failed review rounds ${row.failedReviewRounds} over ${changes(row.mergedChanges)}, ${perChange(row.failedReviewRoundsPerMergedChange)}; rework ${row.rework} over ${changes(row.mergedChanges)}, ${perChange(row.reworkPerMergedChange)}; ${coverageText(row.reviewedChanges, row.mergedChanges, row.reviewCoverage)}`,
  );
  const unlinkedLine = `${TITLE}, unlinked row (${changes(unlinked.mergedChanges)} with no writer tier): failed review rounds ${unlinked.failedReviewRounds}; rework not read, no writer tier; ${coverageText(unlinked.reviewedChanges, unlinked.mergedChanges, unlinked.reviewCoverage)}`;
  return [...tierLines, unlinkedLine];
}

/**
 * The review round lines, then, when the report carries a split, the before side and the after side,
 * each under a header naming the date.
 */
export function reviewRoundReportLines({
  reviewRounds,
  reviewRoundsSplit,
}: Pick<FlowReport, "reviewRounds" | "reviewRoundsSplit">): string[] {
  if (reviewRoundsSplit === undefined) {
    return reviewRoundLines(reviewRounds);
  }
  const { at, before, after } = reviewRoundsSplit;
  const indented = (rounds: ReviewRounds) =>
    reviewRoundLines(rounds).map((line) => `  ${line}`);
  return [
    ...reviewRoundLines(reviewRounds),
    `Failed review rounds and review coverage by writer tier, before ${at}:`,
    ...indented(before),
    `Failed review rounds and review coverage by writer tier, on or after ${at}:`,
    ...indented(after),
  ];
}
