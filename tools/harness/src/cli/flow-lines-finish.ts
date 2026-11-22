// The finish detection and silent session lines of the human flow report (#1090, #1782). The
// figures are reported readings: finish lag is not a merge delay, and the detection window
// is a placeholder until the owner sets it. With a terminal event in the ledger each figure
// prints once per source, labelled, and never blended across them.

import type { FlowReport } from "../flow/index.js";

type Source = "herdr" | "terminal";
type Pane = Pick<FlowReport, "finishDetection" | "stalledPanes">;

const NOTE =
  "Finish detection and stalls read per ledger source: a terminal's finish is noticed almost at once and its stall is a blocked or error event, so compare each source with its own history.";

/** A figure's name, with its source in brackets when the ledger has two sources. */
const labelled = (label: string, source?: Source) =>
  source === undefined ? label : `${label} (${source})`;

/** The three lines of one source's pane figures. Without a source they are the herdr-era lines, unchanged. */
function paneLines(
  { finishDetection, stalledPanes }: Pane,
  source?: Source,
): string[] {
  const { results, detected, neverNoticed, late, windowSeconds, lagMinutes } =
    finishDetection;
  const recorder =
    source === "terminal" ? "the terminal watch" : "session wait";
  const detection =
    results === 0
      ? `${labelled("Finish detection", source)}: no results with a pane in this range`
      : `${labelled("Finish detection", source)}: ${detected} of ${results} results noticed (a pane.finished recorded by ${recorder} on the result's pane within the ${windowSeconds}s placeholder window); never noticed ${neverNoticed}, late ${late}`;
  const lagName = labelled("Finish lag in minutes, detected and late", source);
  const lag =
    lagMinutes.samples === 0
      ? `${lagName}: no finish with a lag`
      : `${lagName}: median ${lagMinutes.median}, p90 ${lagMinutes.p90}, over ${lagMinutes.samples} finishes. Not a merge delay.`;
  const silent = `${labelled("Silent sessions", source)}: ${stalledPanes.silentSessions} (last token usage more than ${stalledPanes.silenceSeconds}s earlier and no RESULT since; background-command excluded ${stalledPanes.backgroundExcluded}, open-question excluded ${stalledPanes.questionExcluded}); recorded pane.stalled: ${stalledPanes.recorded}`;
  return [detection, lag, silent];
}

/** The finish and silent session lines: the herdr lines as before, and the terminal source's beside them when the ledger holds one. */
export function finishLines({
  terminal,
  ...herdr
}: Pick<
  FlowReport,
  "finishDetection" | "stalledPanes" | "terminal"
>): string[] {
  if (terminal === null) {
    return paneLines(herdr);
  }
  return [
    NOTE,
    ...paneLines(herdr, "herdr"),
    ...paneLines(terminal, "terminal"),
  ];
}
