// The Haiku-Sonnet break-even for the flow report's text (#1051), printed beside Haiku's rework rate
// with the medians it uses and the count each median is read over, and with the same figure on each
// side of the split date when the report has one (#1047). A break-even that is not read says why and
// prints no break-even. The line names no winner.

import type { BreakEven, FlowReport, ReviewRounds } from "../flow/index.js";
import { changes } from "./flow-lines-writer-cost.js";

const TITLE = "Haiku-Sonnet break-even";

const money = (value: number) => `$${value}`;

/** A median with the merged changes it is read over, or that there is none. */
const medianText = (group: { changes: number; median: number | null }) =>
  group.median === null
    ? "no change"
    : `${money(group.median)} over ${changes(group.changes)}`;

/** Haiku's rework per merged change from the review rounds, or that it is not read. */
function reworkText(tier: string, rounds: ReviewRounds | undefined): string {
  const rate = rounds?.tiers[tier]?.reworkPerMergedChange ?? null;
  return rate === null
    ? `${tier} rework per merged change not read`
    : `${tier} rework ${rate} per merged change`;
}

/** The three medians the break-even is read from, each with its count. */
function mediansText(
  figures: Extract<BreakEven, { haiku: { noRework: unknown } }>,
): string {
  const { haiku, sonnet } = figures;
  return `medians: ${haiku.tier} with no rework ${medianText(haiku.noRework)}, ${haiku.tier} with one rework round ${medianText(haiku.oneRound)}, ${sonnet.tier} ${medianText({ changes: sonnet.mergedChanges, median: sonnet.median })}`;
}

/** The break-even beside Haiku's rework rate, read from the given review rounds. */
export function breakEvenLine(
  breakEven: BreakEven,
  rounds: ReviewRounds | undefined,
): string {
  if (breakEven.status === "insufficient prices") {
    return `${TITLE} not read: no price for ${breakEven.models.join(", ")}`;
  }
  const { haiku, sonnet } = breakEven;
  const rework = reworkText(haiku.tier, rounds);
  if (breakEven.status === "insufficient merged changes") {
    return `${TITLE} not read: insufficient merged changes, ${haiku.tier} ${changes(haiku.mergedChanges)}, ${sonnet.tier} ${changes(sonnet.mergedChanges)}, ${breakEven.needed} needed in each tier; ${rework}`;
  }
  if (breakEven.status === "not read") {
    return `${TITLE} not read: ${breakEven.reason}; ${rework}; ${mediansText(breakEven)}`;
  }
  return `${TITLE}: ${breakEven.reworkRoundsPerMergedChange} rework rounds per merged change at which ${haiku.tier}'s median all-in cost reaches ${sonnet.tier}'s; ${rework}; ${mediansText(breakEven)}; one rework round adds ${money(breakEven.costPerReworkRound)}`;
}

/**
 * The break-even line, then, when the report carries a split, the before side and the after side,
 * each under a header naming the date and read against that side's own rework rate.
 */
export function breakEvenReportLines({
  breakEven,
  breakEvenSplit,
  reviewRounds,
  reviewRoundsSplit,
}: Pick<
  FlowReport,
  "breakEven" | "breakEvenSplit" | "reviewRounds" | "reviewRoundsSplit"
>): string[] {
  const whole = breakEvenLine(breakEven, reviewRounds);
  if (breakEvenSplit === undefined) {
    return [whole];
  }
  const { at, before, after } = breakEvenSplit;
  return [
    whole,
    `${TITLE} by writer tier, before ${at}:`,
    `  ${breakEvenLine(before, reviewRoundsSplit?.before)}`,
    `${TITLE} by writer tier, on or after ${at}:`,
    `  ${breakEvenLine(after, reviewRoundsSplit?.after)}`,
  ];
}
