import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasOpenBackground } from "./background.js";
import { plannedStalls } from "./herdr-stall.js";
import type { LedgerEvent } from "./schema.js";

vi.mock("./background.js", () => ({ hasOpenBackground: vi.fn() }));

const T0 = Date.parse("2026-01-02T03:00:00.000Z");
const at = (minutes: number) => T0 + minutes * 60_000;
const NOW = new Date(at(60));
const PANE = "w3:p74";

/** A herdr pane event on PANE, at a minute after T0, by the writer agent. */
function pane(minutes: number, kind: LedgerEvent["kind"]): LedgerEvent {
  return {
    schema: 1,
    id: `${kind}-${minutes}`,
    source: "herdr",
    kind,
    occurredAt: new Date(at(minutes)).toISOString(),
    recordedAt: new Date(at(minutes)).toISOString(),
    pane: PANE,
    agent: "writer",
  };
}

/** The session.launch a spawn records on the pane, which marks it as a spawned session. */
const launch = pane(0, "session.launch");

/** A spawned pane: launched, busy, then idle at `idleAt`. */
const spawnedIdleAt = (idleAt: number) => [
  launch,
  pane(1, "pane.busy"),
  pane(idleAt, "pane.waiting"),
];

const STALLED = {
  source: "herdr",
  kind: "pane.stalled",
  occurredAt: NOW.toISOString(),
  pane: PANE,
  agent: "writer",
};

beforeEach(() => {
  vi.mocked(hasOpenBackground).mockReturnValue(false);
});

describe("plannedStalls: a spawned pane idle or gone past five minutes with no RESULT", () => {
  it("plans a pane.stalled for a spawned pane idle for more than five minutes with no RESULT", () => {
    expect(plannedStalls(spawnedIdleAt(2), [], NOW)).toEqual([STALLED]);
  });

  it("plans a pane.stalled at exactly five minutes idle", () => {
    expect(plannedStalls(spawnedIdleAt(55), [], NOW)).toEqual([STALLED]);
  });

  it("plans nothing for a pane idle for less than five minutes", () => {
    expect(plannedStalls(spawnedIdleAt(56), [], NOW)).toEqual([]);
  });

  it("plans a pane.stalled for a spawned pane gone past five minutes with no RESULT", () => {
    expect(
      plannedStalls(
        [launch, pane(1, "pane.busy"), pane(2, "pane.closed")],
        [],
        NOW,
      ),
    ).toEqual([STALLED]);
  });

  it("plans nothing for a pane that printed its RESULT after it last started work", () => {
    const events = [...spawnedIdleAt(4), pane(3, "pane.finished")];
    expect(plannedStalls(events, [], NOW)).toEqual([]);
  });

  it("plans nothing for a pane no session spawned, since the orchestrator's own pane is idle by design", () => {
    const events = [pane(1, "pane.busy"), pane(2, "pane.waiting")];
    expect(plannedStalls(events, [], NOW)).toEqual([]);
  });

  it("plans nothing while the pane has a background command open", () => {
    vi.mocked(hasOpenBackground).mockReturnValue(true);
    expect(plannedStalls(spawnedIdleAt(2), [], NOW)).toEqual([]);
    expect(hasOpenBackground).toHaveBeenCalledWith([], PANE, NOW.getTime());
  });

  it("plans one pane.stalled per idle stretch, not one per poll", () => {
    const events = [...spawnedIdleAt(2), pane(9, "pane.stalled")];
    expect(plannedStalls(events, [], NOW)).toEqual([]);
  });

  it("plans a new pane.stalled for a later idle stretch after work resumed", () => {
    const events = [
      ...spawnedIdleAt(2),
      pane(9, "pane.stalled"),
      pane(12, "pane.busy"),
      pane(13, "pane.waiting"),
    ];
    expect(plannedStalls(events, [], NOW)).toEqual([STALLED]);
  });
});

describe("plannedStalls: the detector never reads token-usage events", () => {
  it("plans nothing from a silent token-usage event, since only herdr's pane state counts", () => {
    const tokens: LedgerEvent = {
      schema: 1,
      id: "token-0",
      source: "claude",
      kind: "token.usage",
      occurredAt: new Date(at(0)).toISOString(),
      recordedAt: new Date(at(0)).toISOString(),
      session: "claude-session-1",
      pane: PANE,
      tokens: 1000,
    };
    const events = [launch, pane(1, "pane.busy"), pane(56, "pane.waiting")];
    expect(plannedStalls(events, [tokens], NOW)).toEqual([]);
  });
});
