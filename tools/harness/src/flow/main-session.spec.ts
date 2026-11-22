// The main session's three figures in the flow report (#940): read from the
// retro.main-session events a scan recorded, over the merged changes and finished
// panes in the scanned windows. Real modules; the events are fixtures.

import { describe, expect, it } from "vitest";
import type { Kind, LedgerEvent, RetroOrigin } from "../ledger/index.js";
import {
  mainSessionFigures,
  MIN_FINISHED_PANES,
  terminalMainSession,
} from "./main-session.js";
import type { Span } from "./scope.js";

const DAY = 86_400_000;
/** The report window is the eleventh day, open at the start and closed at the end. */
const WINDOW: Span = [10 * DAY, 11 * DAY];
const MIN_MERGED = 1;

/** An event at `ms`; its id and times read back as `ms`. */
function event(
  ms: number,
  kind: Kind,
  extra: Partial<LedgerEvent & RetroOrigin> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...extra,
  } satisfies LedgerEvent;
}

/** A retro scan's event: recorded at `recordedAt`, it scanned the window [start, end). */
function scan(
  recordedAt: number,
  start: number,
  end: number,
  figures: Partial<Omit<RetroOrigin, "windowStart" | "windowEnd">> = {},
): LedgerEvent {
  return event(recordedAt, "retro.main-session", {
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
    pollMinutes: 0,
    paneReads: 0,
    signedSends: 0,
    rawSends: 0,
    ...figures,
  });
}

const merged = (ms: number) => event(ms, "pr.merged", { number: 1 });
const finished = (ms: number) => event(ms, "pane.finished", { result: "done" });

/** Enough finished panes in the window to clear the minimum. */
const enoughPanes = () =>
  Array.from({ length: MIN_FINISHED_PANES }, (_, i) =>
    finished(10 * DAY + i * 1000),
  );

/** Two merged changes inside the window, and the scan that read it. */
const scanned = (figures: Partial<RetroOrigin> = {}) => [
  scan(11 * DAY, 10 * DAY, 11 * DAY, figures),
  merged(10 * DAY + 2 * 3600_000),
  merged(10 * DAY + 6 * 3600_000),
  ...enoughPanes(),
];

const figuresOf = (events: LedgerEvent[], minMerged = MIN_MERGED) =>
  mainSessionFigures(events, WINDOW, { minMergedChanges: minMerged });

describe("the main session's figures are read over the scanned windows", () => {
  it("divides the scan's poll minutes by the merged changes, its reads by the finished panes, and its signed sends by all sends", () => {
    const figures = figuresOf(
      scanned({
        pollMinutes: 6,
        paneReads: 3,
        signedSends: 1,
        rawSends: 3,
      }),
    );
    expect(figures.foregroundPollMinutesPerMerged).toEqual({
      status: "ok",
      pollMinutes: 6,
      merged: 2,
      perMerged: 3,
    });
    expect(figures.paneReadsPerFinishedPane).toEqual({
      status: "ok",
      reads: 3,
      finished: MIN_FINISHED_PANES,
      perFinished: 3 / MIN_FINISHED_PANES,
    });
    expect(figures.signedSendShare).toEqual({
      status: "ok",
      signed: 1,
      raw: 3,
      share: 0.25,
    });
  });
});

describe("a rescanned window is counted once", () => {
  it("takes the window's latest scan, not both", () => {
    const earlier = scan(11 * DAY, 10 * DAY, 11 * DAY, { pollMinutes: 4 });
    const later = scan(11.5 * DAY, 10 * DAY, 11 * DAY, { pollMinutes: 10 });
    const figures = figuresOf([
      earlier,
      later,
      merged(10.2 * DAY),
      merged(10.6 * DAY),
      ...enoughPanes(),
    ]);
    expect(figures.foregroundPollMinutesPerMerged).toMatchObject({
      status: "ok",
      pollMinutes: 10,
    });
  });

  it("counts a merged change once when two windows that overlap both hold it", () => {
    const first = scan(11 * DAY, 10 * DAY, 11 * DAY, { pollMinutes: 6 });
    const second = scan(11 * DAY, 10.5 * DAY, 11 * DAY, { pollMinutes: 1 });
    const figures = figuresOf([
      first,
      second,
      merged(10.2 * DAY),
      merged(10.7 * DAY),
      ...enoughPanes(),
    ]);
    expect(figures.foregroundPollMinutesPerMerged).toMatchObject({
      status: "ok",
      merged: 2,
      pollMinutes: 7,
    });
  });
});

describe("a window with too little to read reports insufficient, never zero", () => {
  it("reports insufficient, with the count it needed, when the window has too few merged changes", () => {
    const figures = figuresOf(
      scanned({ pollMinutes: 6 }).filter((e) => e.kind !== "pr.merged"),
    );
    expect(figures.foregroundPollMinutesPerMerged).toEqual({
      status: "insufficient",
      reason: "0 of 1 merged changes needed",
    });
  });

  it("reports insufficient when the window has too few finished panes, and names the count", () => {
    const events = scanned({ paneReads: 3, signedSends: 1 }).filter(
      (e) => e.kind !== "pane.finished",
    );
    const figures = figuresOf([
      ...events,
      finished(10 * DAY),
      finished(10 * DAY + 1),
    ]);
    expect(figures.paneReadsPerFinishedPane).toEqual({
      status: "insufficient",
      reason: `2 of ${MIN_FINISHED_PANES} finished panes needed`,
    });
  });

  it("reports every figure insufficient when no scan is in the window, so an unrecorded scan is not read as zero", () => {
    const figures = figuresOf([merged(10.2 * DAY), ...enoughPanes()]);
    for (const figure of [
      figures.foregroundPollMinutesPerMerged,
      figures.paneReadsPerFinishedPane,
      figures.signedSendShare,
    ]) {
      expect(figure).toEqual({
        status: "insufficient",
        reason: "no retro scan recorded in the window",
      });
    }
  });

  it("leaves out a scan whose window opens before the report window", () => {
    const figures = figuresOf([
      scan(11 * DAY, 9 * DAY, 10 * DAY, { pollMinutes: 99 }),
      ...scanned({ pollMinutes: 6 }).filter(
        (e) => e.kind !== "retro.main-session",
      ),
    ]);
    expect(figures.foregroundPollMinutesPerMerged).toEqual({
      status: "insufficient",
      reason: "no retro scan recorded in the window",
    });
  });

  it("reports the share insufficient when the scans made no pane sends at all", () => {
    const figures = figuresOf(scanned({ pollMinutes: 6, paneReads: 3 }));
    expect(figures.signedSendShare).toEqual({
      status: "insufficient",
      reason: "no pane sends in the window",
    });
    expect(figures.paneReadsPerFinishedPane).toMatchObject({ status: "ok" });
  });
});

describe("the main session's pane figures read the herdr source once a terminal source is in the ledger", () => {
  /** A herdr pane finished inside the window, on pane w<i>. */
  const herdrFinish = (i: number) =>
    event(10 * DAY + i * 1000, "pane.finished", {
      source: "herdr",
      pane: `w${i}`,
      session: `h${i}`,
    });
  const herdrPanes = () =>
    Array.from({ length: MIN_FINISHED_PANES }, (_, i) => herdrFinish(i));
  /** A terminal pane finished inside the window: the scan does not read it. */
  const terminalFinish = event(10 * DAY + 5000, "pane.finished", {
    source: "terminal",
    pane: "t9",
    session: "s9",
  });

  it("counts the finished panes of the herdr source only, and says the signed share does not split by source", () => {
    const figures = figuresOf([
      scan(11 * DAY, 10 * DAY, 11 * DAY, {
        pollMinutes: 6,
        paneReads: 3,
        signedSends: 1,
        rawSends: 3,
      }),
      merged(10 * DAY + 2 * 3600_000),
      ...herdrPanes(),
      terminalFinish,
    ]);
    expect(figures.paneReadsPerFinishedPane).toEqual({
      status: "ok",
      reads: 3,
      finished: MIN_FINISHED_PANES,
      perFinished: 3 / MIN_FINISHED_PANES,
    });
    expect(figures.signedSendShare).toEqual({
      status: "insufficient",
      reason: "the retro scan does not split its sends by source",
    });
  });

  it("keeps the signed share as before when the ledger holds no terminal event", () => {
    const figures = figuresOf([
      scan(11 * DAY, 10 * DAY, 11 * DAY, {
        pollMinutes: 6,
        paneReads: 3,
        signedSends: 1,
        rawSends: 3,
      }),
      merged(10 * DAY + 2 * 3600_000),
      ...herdrPanes(),
    ]);
    expect(figures.signedSendShare).toEqual({
      status: "ok",
      signed: 1,
      raw: 3,
      share: 0.25,
    });
  });

  it("reads the terminal source's pane figures as insufficient, since the scan records herdr reads only", () => {
    expect(terminalMainSession()).toEqual({
      paneReadsPerFinishedPane: {
        status: "insufficient",
        reason: "the retro scan counts herdr pane reads only",
      },
      signedSendShare: {
        status: "insufficient",
        reason: "the retro scan does not split its sends by source",
      },
    });
  });
});
