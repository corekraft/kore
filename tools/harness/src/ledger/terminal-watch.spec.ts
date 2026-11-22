import { describe, expect, it } from "vitest";
import type { EventInput } from "./schema.js";
import type { Terminal } from "../terminal/index.js";
import { lastReadings, planTerminals } from "./terminal-watch.js";

const AT = "2026-11-22T10:00:00.000Z";

/** A session terminal as hc reports it, with the kore-session label the watch records. */
function terminal(overrides: Partial<Terminal> = {}): Terminal {
  return {
    id: "t2",
    state: "live",
    labels: { "kore-session": "s1" },
    cwd: "/work",
    ...overrides,
  };
}

/** The events a plan appends, with the ledger's last reading of each terminal before it. */
function planned(terminals: Terminal[], events: EventInput[] = []) {
  return planTerminals(terminals, lastReadings(events), AT);
}

describe("planTerminals: a status becomes the kind it is recorded as", () => {
  it.each([
    ["working", "pane.busy"],
    ["idle", "pane.waiting"],
    ["done", "pane.waiting"],
    ["blocked", "pane.stalled"],
    ["error", "pane.stalled"],
    ["unreported", "pane.spawned"],
  ])("records a live %s terminal as %s", (status, kind) => {
    const status_ =
      status === "unreported" ? undefined : (status as Terminal["status"]);
    expect(planned([terminal({ status: status_ })]).events).toEqual([
      {
        source: "terminal",
        kind,
        occurredAt: AT,
        pane: "t2",
        session: "s1",
        status,
        turn: 0,
      },
    ]);
  });

  it("records a finished terminal as pane.finished, with its final status last", () => {
    expect(
      planned([terminal({ state: "finished", status: "working", exitCode: 0 })])
        .events,
    ).toEqual([
      {
        source: "terminal",
        kind: "pane.finished",
        occurredAt: AT,
        pane: "t2",
        session: "s1",
        status: "finished",
        turn: 0,
      },
    ]);
  });
});

describe("planTerminals: the gap while the watch was down", () => {
  it("records a terminal that finished while the watch was down once, with its final status last", () => {
    const last: EventInput[] = [
      {
        source: "terminal",
        kind: "pane.busy",
        occurredAt: AT,
        pane: "t2",
        session: "s1",
        status: "working",
        turn: 0,
      },
    ];
    const result = planned(
      [terminal({ state: "finished", status: "working" })],
      last,
    );
    expect(result.events.map((e) => [e.kind, e.status])).toEqual([
      ["pane.finished", "finished"],
    ]);
  });
});

describe("planTerminals: a duplicate is recorded once", () => {
  it("records nothing for a terminal whose status and turn are the last recorded", () => {
    const last: EventInput[] = [
      {
        source: "terminal",
        kind: "pane.waiting",
        occurredAt: AT,
        pane: "t2",
        session: "s1",
        status: "idle",
        turn: 0,
      },
    ];
    expect(
      planned([terminal({ status: "idle", turn: 0 })], last).events,
    ).toEqual([]);
  });

  it("records a terminal's turn when the turn advances, even with the same status", () => {
    const last: EventInput[] = [
      {
        source: "terminal",
        kind: "pane.waiting",
        occurredAt: AT,
        pane: "t2",
        session: "s1",
        status: "idle",
        turn: 0,
      },
    ];
    expect(
      planned([terminal({ status: "idle", turn: 1 })], last).events,
    ).toEqual([
      {
        source: "terminal",
        kind: "pane.waiting",
        occurredAt: AT,
        pane: "t2",
        session: "s1",
        status: "idle",
        turn: 1,
      },
    ]);
  });

  it("plans a terminal listed twice in one pass once", () => {
    const busy = terminal({ status: "working" });
    expect(planned([busy, busy]).events).toHaveLength(1);
  });

  it("records nothing again when its own plan is read back as the last recorded", () => {
    const first = planned([terminal({ status: "working" })]).events;
    expect(planned([terminal({ status: "working" })], first).events).toEqual(
      [],
    );
  });
});

describe("planTerminals: which terminals the watch records", () => {
  it("ignores a terminal that carries no kore-session label", () => {
    expect(planned([terminal({ labels: { role: "writer" } })]).events).toEqual(
      [],
    );
  });

  it("names the session by its kore-session label on every event", () => {
    const [event] = planned([
      terminal({ labels: { "kore-session": "build" } }),
    ]).events;
    expect(event?.session).toBe("build");
  });
});

describe("lastReadings: the last reading of each terminal, from the ledger", () => {
  it("reads the last terminal event per pane, in ledger order, and ignores herdr events", () => {
    const events: EventInput[] = [
      {
        source: "terminal",
        kind: "pane.busy",
        occurredAt: AT,
        pane: "t2",
        status: "working",
        turn: 0,
      },
      { source: "herdr", kind: "pane.busy", occurredAt: AT, pane: "t2" },
      {
        source: "terminal",
        kind: "pane.waiting",
        occurredAt: AT,
        pane: "t2",
        status: "idle",
        turn: 1,
      },
    ];
    expect(lastReadings(events)).toEqual(
      new Map([["t2", { status: "idle", turn: 1 }]]),
    );
  });
});
