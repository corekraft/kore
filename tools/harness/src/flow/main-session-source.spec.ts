// The main session's pane figures once a terminal source is in the ledger (#1782). The
// herdr reads and finished panes are herdr's; the scan's signed sends are net of the terminal
// sends the main session made in the same windows. The ledger split is mocked here: it is
// its own unit with its own spec.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent, RetroOrigin } from "../ledger/index.js";
import { sourceSplit } from "./ledger-source.js";
import {
  mainSessionFigures,
  MIN_FINISHED_PANES,
  terminalMainSession,
} from "./main-session.js";
import type { Span } from "./scope.js";

vi.mock("./ledger-source.js");

const DAY = 86_400_000;
const WINDOW: Span = [10 * DAY, 11 * DAY];

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

/** A retro scan that scanned the day before it was recorded, with the figures given. */
function scan(figures: Partial<RetroOrigin> = {}): LedgerEvent {
  return event(11 * DAY, "retro.main-session", {
    windowStart: new Date(10 * DAY).toISOString(),
    windowEnd: new Date(11 * DAY).toISOString(),
    pollMinutes: 0,
    paneReads: 0,
    signedSends: 0,
    rawSends: 0,
    ...figures,
  });
}

const merged = event(10 * DAY + 3600_000, "pr.merged", { number: 1 });

/** Herdr panes finished inside the window: enough to clear the minimum. */
const herdrPanes = () =>
  Array.from({ length: MIN_FINISHED_PANES }, (_, i) =>
    event(10 * DAY + i * 1000, "pane.finished", {
      source: "herdr",
      pane: `w${i}`,
      session: `h${i}`,
    }),
  );

/** A terminal send the main session made: a `harness session send` on a terminal, with no sender role. */
const terminalMainSend = (ms: number) =>
  event(ms, "session.send", { source: "terminal", pane: "t1", agent: "main" });

const figuresOf = (events: LedgerEvent[]) =>
  mainSessionFigures(events, WINDOW, { minMergedChanges: 1 });

beforeEach(() => {
  // A test double with the documented semantics: a terminal-source event reads as terminal, all others as herdr.
  vi.mocked(sourceSplit).mockImplementation((events) => ({
    terminal: events.some((e) => e.source === "terminal"),
    of: vi.fn(),
    view: (list, source) =>
      list.filter((e) => (e.source === "terminal") === (source === "terminal")),
  }));
});

describe("the main session's herdr signed share is read as before, net of the terminal sends", () => {
  it("takes the terminal sends the main session made out of the scan's signed sends", () => {
    const figures = figuresOf([
      scan({ pollMinutes: 6, paneReads: 3, signedSends: 3, rawSends: 3 }),
      merged,
      ...herdrPanes(),
      terminalMainSend(10 * DAY + 5000),
    ]);
    expect(figures.signedSendShare).toEqual({
      status: "ok",
      signed: 2,
      raw: 3,
      share: 0.4,
    });
  });

  it("reads the herdr signed share exactly as before when the ledger holds no terminal event", () => {
    const figures = figuresOf([
      scan({ pollMinutes: 6, paneReads: 3, signedSends: 1, rawSends: 3 }),
      merged,
      ...herdrPanes(),
    ]);
    expect(figures.signedSendShare).toEqual({
      status: "ok",
      signed: 1,
      raw: 3,
      share: 0.25,
    });
  });

  it("does not take a terminal send a role made out of the main session's count", () => {
    const roleSend = event(10 * DAY + 5000, "session.send", {
      source: "terminal",
      pane: "t1",
      agent: "writer",
      senderRole: "writer",
    });
    const figures = figuresOf([
      scan({ pollMinutes: 6, paneReads: 3, signedSends: 3, rawSends: 3 }),
      merged,
      ...herdrPanes(),
      roleSend,
    ]);
    expect(figures.signedSendShare).toEqual({
      status: "ok",
      signed: 3,
      raw: 3,
      share: 0.5,
    });
  });
});

describe("the main session's herdr source and its signed share limit", () => {
  it("says the share is insufficient, with why, when the ledger holds more terminal sends than the scan counted as signed", () => {
    const figures = figuresOf([
      scan({ pollMinutes: 6, paneReads: 3, signedSends: 1, rawSends: 3 }),
      merged,
      ...herdrPanes(),
      terminalMainSend(10 * DAY + 5000),
      terminalMainSend(10 * DAY + 6000),
    ]);
    expect(figures.signedSendShare).toEqual({
      status: "insufficient",
      reason:
        "the ledger holds more terminal sends than the scan counted as signed",
    });
  });

  it("still counts the finished panes of the herdr source only", () => {
    const terminalFinish = event(10 * DAY + 5000, "pane.finished", {
      source: "terminal",
      pane: "t9",
      session: "s9",
    });
    const figures = figuresOf([
      scan({ pollMinutes: 6, paneReads: 3, signedSends: 1, rawSends: 3 }),
      merged,
      ...herdrPanes(),
      terminalFinish,
    ]);
    expect(figures.paneReadsPerFinishedPane).toEqual({
      status: "ok",
      reads: 3,
      finished: MIN_FINISHED_PANES,
      perFinished: 3 / MIN_FINISHED_PANES,
    });
  });
});

describe("the main session's terminal reading is insufficient, with why", () => {
  it("names the missing data: the scan counts no terminal reads and no raw terminal sends", () => {
    expect(terminalMainSession()).toEqual({
      paneReadsPerFinishedPane: {
        status: "insufficient",
        reason: "the retro scan counts herdr pane reads only",
      },
      signedSendShare: {
        status: "insufficient",
        reason:
          "the retro scan counts no raw terminal sends, so no terminal share is read",
      },
    });
  });
});
