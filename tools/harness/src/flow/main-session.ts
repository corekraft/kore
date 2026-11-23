// The main session's three figures (#940, ideas 0019 to 0021): poll minutes per merged
// change, pane-result reads per finished pane, and the signed share of pane sends. Each
// is read from the retro.main-session events a retro scan recorded, over the merged
// changes and finished panes in the windows those scans read. Nothing here is reported
// to the owner.

import type { LedgerEvent, RetroOrigin } from "../ledger/index.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import { time } from "./github-waits.js";
import { sourceSplit } from "./ledger-source.js";
import { inWindow, type Span } from "./scope.js";

/** The window the figures are read over: the same span the per-merged figures use. */
export type { Span };
/** A figure a window cannot read: the reason is named, and no value is given. */
const insufficient = (reason: string): Insufficient => ({
  status: "insufficient",
  reason,
});

/** The reason a terminal source's pane figures are not read: the scan counts herdr reads only (#1782). */
const TERMINAL_READS_REASON = "the retro scan counts herdr pane reads only";
/** The reason the terminal signed share is not read: the scan counts no raw terminal sends (#1782). */
const TERMINAL_SENDS_REASON =
  "the retro scan counts no raw terminal sends, so no terminal share is read";
/** The reason the herdr signed share is not read when the ledger holds more terminal sends than the scan counted (#1782). */
const SIGNED_SHORT_REASON =
  "the ledger holds more terminal sends than the scan counted as signed";

/** The main session's handover count (#1036), read beside its three figures. */
export { handoverCount, type HandoverCount } from "./handover-count.js";
/** The compaction count (#1037), read beside them. */
export { compactionCount, type CompactionCount } from "./compaction-count.js";
/** The setup label of each main-session stretch (#1046), read beside them. */
export {
  mainSessionSetups,
  type MainSessionSetups,
} from "./main-session-setups.js";

/** The fewest finished panes a window needs before its pane figures are read; a placeholder, like the merged minimum. */
export const MIN_FINISHED_PANES = 10;

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** A figure a window cannot read: the reason is named, and no value is given. */
export interface Insufficient {
  status: "insufficient";
  reason: string;
}

export type PollFigure =
  | Insufficient
  | {
      status: "ok";
      /** Foreground poll minutes the scans counted. */
      pollMinutes: number;
      merged: number;
      perMerged: number;
    };

export type ReadFigure =
  | Insufficient
  | {
      status: "ok";
      reads: number;
      finished: number;
      perFinished: number;
    };

export type ShareFigure =
  | Insufficient
  | {
      status: "ok";
      signed: number;
      raw: number;
      /** Signed sends over signed plus raw sends, to four places. */
      share: number;
    };

/** The `mainSession` section of the flow report: one measured figure per idea's primary. */
export interface MainSessionFigures {
  foregroundPollMinutesPerMerged: PollFigure;
  paneReadsPerFinishedPane: ReadFigure;
  signedSendShare: ShareFigure;
}

/** A retro.main-session event: the ledger checked its fields when it stored it. */
type Scan = LedgerEvent & RetroOrigin;
const isScan = (event: LedgerEvent): event is Scan =>
  event.kind === "retro.main-session";

/**
 * The latest scan of each window, among those whose window opens in the report
 * window. A rescan from the same start replaces the earlier scan, so it counts once.
 */
function scansIn(events: LedgerEvent[], window: Span): Scan[] {
  const latest = new Map<string, Scan>();
  for (const event of events) {
    if (!isScan(event) || !inWindow(window, Date.parse(event.windowStart))) {
      continue;
    }
    const prior = latest.get(event.windowStart);
    if (prior === undefined || time(event) > time(prior)) {
      latest.set(event.windowStart, event);
    }
  }
  return [...latest.values()];
}

/** Counts the events of one kind that fall in any of the scanned windows, so each is counted once. */
function countIn(
  events: LedgerEvent[],
  kind: LedgerEvent["kind"],
  spans: Span[],
): number {
  return events.filter(
    (event) =>
      event.kind === kind && spans.some((span) => inWindow(span, time(event))),
  ).length;
}

/** The reason the windows cannot be read yet, or undefined when they can. */
function insufficientReason(
  scans: number,
  merged: number,
  finished: number,
  minMergedChanges: number,
): string | undefined {
  if (scans === 0) {
    return "no retro scan recorded in the window";
  }
  if (merged < minMergedChanges) {
    return `${merged} of ${minMergedChanges} merged changes needed`;
  }
  if (finished < MIN_FINISHED_PANES) {
    return `${finished} of ${MIN_FINISHED_PANES} finished panes needed`;
  }
  return undefined;
}

/**
 * The main session's three figures over the report window. A figure whose windows
 * are too small, or that has no scan at all, says why and gives no value, never zero.
 */
export function mainSessionFigures(
  events: LedgerEvent[],
  window: Span,
  cost: Partial<CostOptions> = {},
): MainSessionFigures {
  const scans = scansIn(events, window);
  const split = sourceSplit(events);
  const herdr = split.view(events, "herdr");
  const spans: Span[] = scans.map((scan) => [
    Date.parse(scan.windowStart),
    Date.parse(scan.windowEnd),
  ]);
  const merged = countIn(events, "pr.merged", spans);
  const finished = countIn(herdr, "pane.finished", spans);
  const gate = insufficientReason(
    scans.length,
    merged,
    finished,
    { ...DEFAULT_COST, ...cost }.minMergedChanges,
  );
  const sum = (pick: (scan: Scan) => number) =>
    scans.reduce((total, scan) => total + pick(scan), 0);
  const pollMinutes = sum((scan) => scan.pollMinutes);
  const reads = sum((scan) => scan.paneReads);
  // The scan counts every `harness session send`, on herdr or a terminal. The main session's terminal
  // sends in the same windows are taken out, so the herdr share reads its own sends (#1782).
  const terminalSends = countIn(
    events.filter(
      (e) =>
        e.source === "terminal" &&
        e.kind === "session.send" &&
        e.senderRole === undefined,
    ),
    "session.send",
    spans,
  );
  const signed = sum((scan) => scan.signedSends) - terminalSends;
  const raw = sum((scan) => scan.rawSends);
  if (gate !== undefined) {
    return {
      foregroundPollMinutesPerMerged: insufficient(gate),
      paneReadsPerFinishedPane: insufficient(gate),
      signedSendShare: insufficient(gate),
    };
  }
  return {
    foregroundPollMinutesPerMerged: {
      status: "ok",
      pollMinutes: round(pollMinutes),
      merged,
      perMerged: round(pollMinutes / merged),
    },
    paneReadsPerFinishedPane: {
      status: "ok",
      reads,
      finished,
      perFinished: round(reads / finished),
    },
    signedSendShare: signedShare(signed, raw),
  };
}

/** The signed share, or why it is not read: a negative herdr count means the scan missed terminal sends, and no send is no share. */
function signedShare(signed: number, raw: number): ShareFigure {
  if (signed < 0) {
    return insufficient(SIGNED_SHORT_REASON);
  }
  if (signed + raw === 0) {
    return insufficient("no pane sends in the window");
  }
  return { status: "ok", signed, raw, share: round(signed / (signed + raw)) };
}

/**
 * The terminal source's reading of the main session's pane figures (#1782): the scan
 * counts herdr reads and raw sends only, so neither is read for a terminal pane.
 */
export function terminalMainSession(): Pick<
  MainSessionFigures,
  "paneReadsPerFinishedPane" | "signedSendShare"
> {
  return {
    paneReadsPerFinishedPane: {
      status: "insufficient",
      reason: TERMINAL_READS_REASON,
    },
    signedSendShare: { status: "insufficient", reason: TERMINAL_SENDS_REASON },
  };
}
