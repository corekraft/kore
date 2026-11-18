// The main session's three figures (#940, ideas 0019 to 0021): poll minutes per merged
// change, pane-result reads per finished pane, and the signed share of pane sends. Each
// is read from the retro.main-session events a retro scan recorded, over the merged
// changes and finished panes in the windows those scans read. Nothing here goes into
// the owner digest.

import type { LedgerEvent, RetroOrigin } from "../ledger/index.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/** The window the figures are read over: the same span the per-merged figures use. */
export type { Span };
/** The main session's handover count (#1036), read beside its three figures. */
export { handoverCount, type HandoverCount } from "./handover-count.js";
/** The compaction count (#1037), read beside them. */
export { compactionCount, type CompactionCount } from "./compaction-count.js";

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
  const spans: Span[] = scans.map((scan) => [
    Date.parse(scan.windowStart),
    Date.parse(scan.windowEnd),
  ]);
  const merged = countIn(events, "pr.merged", spans);
  const finished = countIn(events, "pane.finished", spans);
  const gate = insufficientReason(
    scans.length,
    merged,
    finished,
    { ...DEFAULT_COST, ...cost }.minMergedChanges,
  );
  const insufficient = (reason: string): Insufficient => ({
    status: "insufficient",
    reason,
  });
  const sum = (pick: (scan: Scan) => number) =>
    scans.reduce((total, scan) => total + pick(scan), 0);
  const pollMinutes = sum((scan) => scan.pollMinutes);
  const reads = sum((scan) => scan.paneReads);
  const signed = sum((scan) => scan.signedSends);
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
    signedSendShare:
      signed + raw === 0
        ? insufficient("no pane sends in the window")
        : {
            status: "ok",
            signed,
            raw,
            share: round(signed / (signed + raw)),
          },
  };
}
