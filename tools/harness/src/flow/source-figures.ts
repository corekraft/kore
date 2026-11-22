// The pane figures of the flow report, read per ledger source (#1782). The top level is the
// herdr reading; `terminal` is the terminal source's, or null when the ledger holds no terminal
// event, and then the top level is the whole ledger as before. A terminal's finish is noticed
// almost at once and its stall is a blocked or error event, so each source compares with its own.

import type { LedgerEvent } from "../ledger/index.js";
import {
  finishDetection,
  leadTime,
  stalledPanes,
  type FinishDetection,
  type LeadTime,
  type StalledPanes,
} from "./idea-metrics.js";
import {
  sourcedIdeas,
  sourceSplit,
  type SourceSplit,
} from "./ledger-source.js";
import {
  terminalMainSession,
  type MainSessionFigures,
} from "./main-session.js";
import type { Span } from "./scope.js";

/** The pane figures the terminal source reads: the readers over its view of the ledger. */
export interface TerminalFigures {
  finishDetection: FinishDetection;
  stalledPanes: StalledPanes;
  leadTime: LeadTime;
  /** The main session's pane figures for the terminal source: insufficient, with why. */
  mainSession: Pick<
    MainSessionFigures,
    "paneReadsPerFinishedPane" | "signedSendShare"
  >;
}

export interface SourceFigures {
  finishDetection: FinishDetection;
  stalledPanes: StalledPanes;
  leadTime: LeadTime;
  terminal: TerminalFigures | null;
}

/** The terminal source's readings, over the events and ideas that source reads. */
function terminalReading(
  named: LedgerEvent[],
  byIdea: Map<string, LedgerEvent[]>,
  split: SourceSplit,
  window: Span,
  asOf: number,
): TerminalFigures {
  const view = split.view(named, "terminal");
  return {
    finishDetection: finishDetection(view, window),
    stalledPanes: stalledPanes(view, window, asOf),
    leadTime: leadTime(sourcedIdeas(byIdea, split, "terminal"), window),
    mainSession: terminalMainSession(),
  };
}

/** The pane figures of one ledger: the herdr reading at the top level, the terminal one under `terminal`. */
export function sourceFigures(
  events: LedgerEvent[],
  named: LedgerEvent[],
  byIdea: Map<string, LedgerEvent[]>,
  window: Span,
  asOf: number,
): SourceFigures {
  const split = sourceSplit(events);
  const herdr = split.view(named, "herdr");
  return {
    finishDetection: finishDetection(herdr, window),
    stalledPanes: stalledPanes(herdr, window, asOf),
    leadTime: leadTime(sourcedIdeas(byIdea, split, "herdr"), window),
    terminal: split.terminal
      ? terminalReading(named, byIdea, split, window, asOf)
      : null,
  };
}
