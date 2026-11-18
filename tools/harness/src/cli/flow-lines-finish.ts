// The finish detection and silent session lines of the human flow report (#1090). The
// figures are reported readings: finish lag is not a merge delay, and the detection window
// is a placeholder until the owner sets it.

import type { FlowReport } from "../flow/index.js";

type Figures = Pick<FlowReport, "finishDetection" | "stalledPanes">;

/** The three lines: the detector's split, the minutes lag, and the silent sessions beside the recorded stalls. */
export function finishLines({
  finishDetection,
  stalledPanes,
}: Figures): string[] {
  const { results, detected, neverNoticed, late, windowSeconds, lagMinutes } =
    finishDetection;
  const detection =
    results === 0
      ? "Finish detection: no results with a pane in this range"
      : `Finish detection: ${detected} of ${results} results noticed (a pane.finished recorded by session wait on the result's pane within the ${windowSeconds}s placeholder window); never noticed ${neverNoticed}, late ${late}`;
  const lag =
    lagMinutes.samples === 0
      ? "Finish lag in minutes, detected and late: no finish with a lag"
      : `Finish lag in minutes, detected and late: median ${lagMinutes.median}, p90 ${lagMinutes.p90}, over ${lagMinutes.samples} finishes. Not a merge delay.`;
  const silent = `Silent sessions: ${stalledPanes.silentSessions} (last token usage more than ${stalledPanes.silenceSeconds}s earlier and no RESULT since; background-command excluded ${stalledPanes.backgroundExcluded}, open-question excluded ${stalledPanes.questionExcluded}); recorded pane.stalled: ${stalledPanes.recorded}`;
  return [detection, lag, silent];
}
