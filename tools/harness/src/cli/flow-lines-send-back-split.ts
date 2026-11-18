// The send-backs per writer tier for the flow report's text, with the same figures on each side of
// the split date when the report has one (#1047). Without a split date it prints the tier lines
// alone, so the text is exactly what it was.

import type { FlowReport, SendBackTiers } from "../flow/index.js";
import { sendBackTierLines } from "./flow-lines-send-back.js";

/**
 * The tier lines, then, when the report carries a split, the before side and the after side, each
 * under a header naming the date.
 */
export function sendBackTierReportLines({
  sendBackTiers,
  sendBackTiersSplit,
}: Pick<FlowReport, "sendBackTiers" | "sendBackTiersSplit">): string[] {
  if (sendBackTiersSplit === undefined) {
    return sendBackTierLines(sendBackTiers);
  }
  const { at, before, after } = sendBackTiersSplit;
  const indented = (tiers: SendBackTiers) =>
    sendBackTierLines(tiers).map((line) => `  ${line}`);
  return [
    ...sendBackTierLines(sendBackTiers),
    `Send-backs by writer tier, before ${at}:`,
    ...indented(before),
    `Send-backs by writer tier, on or after ${at}:`,
    ...indented(after),
  ];
}
