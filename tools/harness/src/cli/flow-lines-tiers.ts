// The per-writer-tier lines of the flow report's text: the send-backs by category (#1045, #1047), the
// failed review rounds beside rework with the review coverage (#1050), the violations by rule and
// the Haiku-Sonnet break-even (#1051), each with its split lines when the report has a split date.
// One entry for the report command to call.

import type { FlowReport } from "../flow/index.js";
import { breakEvenReportLines } from "./flow-lines-break-even.js";
import { reviewRoundReportLines } from "./flow-lines-review-rounds.js";
import { sendBackTierReportLines } from "./flow-lines-send-back-split.js";
import { violationReportLines } from "./flow-lines-violations.js";

/** The tier figures the lines are read from, each with its optional split. */
export type TierReport = Pick<
  FlowReport,
  | "sendBackTiers"
  | "sendBackTiersSplit"
  | "reviewRounds"
  | "reviewRoundsSplit"
  | "violationsByRule"
  | "violationsByRuleSplit"
  | "breakEven"
  | "breakEvenSplit"
>;

/**
 * The send-back tier lines, the review round lines, the violation lines, then the break-even line,
 * which names Haiku's rework rate and so follows the review round lines that print rework.
 */
export function writerTierReportLines(report: TierReport): string[] {
  return [
    ...sendBackTierReportLines(report),
    ...reviewRoundReportLines(report),
    ...violationReportLines(report),
    ...breakEvenReportLines(report),
  ];
}
