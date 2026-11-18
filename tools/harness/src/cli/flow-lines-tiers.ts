// The per-writer-tier lines of the flow report's text: the send-backs by category (#1045, #1047) and
// the failed review rounds beside rework with the review coverage (#1050), each with its split lines
// when the report has a split date. One entry for the report command to call.

import type { FlowReport } from "../flow/index.js";
import { reviewRoundReportLines } from "./flow-lines-review-rounds.js";
import { sendBackTierReportLines } from "./flow-lines-send-back-split.js";

/** The tier figures the lines are read from: the send-backs and the review rounds, each with its optional split. */
export type TierReport = Pick<
  FlowReport,
  "sendBackTiers" | "sendBackTiersSplit" | "reviewRounds" | "reviewRoundsSplit"
>;

/** The send-back tier lines, then the review round lines. */
export function writerTierReportLines(report: TierReport): string[] {
  return [
    ...sendBackTierReportLines(report),
    ...reviewRoundReportLines(report),
  ];
}
