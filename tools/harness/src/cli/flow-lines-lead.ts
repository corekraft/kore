// The lead time line of the human flow report (#1782): one line, or one per source when the
// ledger holds a terminal event. Each idea reads under the source of its first pane or session event.

import type { FlowReport } from "../flow/index.js";

export const seconds = (value: number) => `${Math.round(value)}s`;

function leadLine(
  label: string,
  { ideas, medianSeconds, maxSeconds }: FlowReport["leadTime"],
): string {
  return medianSeconds === null || maxSeconds === null
    ? `${label}: no completed ideas`
    : `${label}: ${ideas.length} ideas, median ${seconds(medianSeconds)}, max ${seconds(maxSeconds)}`;
}

/** The lead time lines: the herdr reading as before, and the terminal one beside it when the ledger holds one. */
export function leadLines({
  leadTime,
  terminal,
}: Pick<FlowReport, "leadTime" | "terminal">): string[] {
  if (terminal === null) {
    return [leadLine("Lead time", leadTime)];
  }
  return [
    leadLine("Lead time (herdr)", leadTime),
    leadLine("Lead time (terminal)", terminal.leadTime),
  ];
}
