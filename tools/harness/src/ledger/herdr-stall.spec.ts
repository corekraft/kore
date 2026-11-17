import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasOpenBackground } from "./background.js";
import { plannedStalls } from "./herdr-stall.js";
import { hasOpenQuestion } from "./open-question.js";
import type { LedgerEvent } from "./schema.js";

vi.mock("./background.js", () => ({ hasOpenBackground: vi.fn() }));
vi.mock("./open-question.js", () => ({ hasOpenQuestion: vi.fn() }));

const T0 = Date.parse("2026-01-02T03:00:00.000Z");
const at = (minutes: number) => T0 + minutes * 60_000;
const NOW = new Date(at(60));
const PANE = "w3:p74";
/** No decision.routed or owner.replied question events: the detector's second source is empty. */
const NO_QUESTIONS: LedgerEvent[] = [];

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
  vi.mocked(hasOpenQuestion).mockReturnValue(false);
});

describe("plannedStalls: a spawned pane idle or gone past five minutes with no RESULT", () => {
  it("plans a pane.stalled for a spawned pane idle for more than five minutes with no RESULT", () => {
    expect(plannedStalls(spawnedIdleAt(2), [], NOW, NO_QUESTIONS)).toEqual([
      STALLED,
    ]);
  });

  it("plans a pane.stalled at exactly five minutes idle", () => {
    expect(plannedStalls(spawnedIdleAt(55), [], NOW, NO_QUESTIONS)).toEqual([
      STALLED,
    ]);
  });

  it("plans nothing for a pane idle for less than five minutes", () => {
    expect(plannedStalls(spawnedIdleAt(56), [], NOW, NO_QUESTIONS)).toEqual([]);
  });

  it("plans a pane.stalled for a spawned pane gone past five minutes with no RESULT", () => {
    expect(
      plannedStalls(
        [launch, pane(1, "pane.busy"), pane(2, "pane.closed")],
        [],
        NOW,
        NO_QUESTIONS,
      ),
    ).toEqual([STALLED]);
  });

  it("plans nothing for a pane that printed its RESULT after it last started work", () => {
    const events = [...spawnedIdleAt(4), pane(3, "pane.finished")];
    expect(plannedStalls(events, [], NOW, NO_QUESTIONS)).toEqual([]);
  });

  it("plans nothing for a pane no session spawned, since the orchestrator's own pane is idle by design", () => {
    const events = [pane(1, "pane.busy"), pane(2, "pane.waiting")];
    expect(plannedStalls(events, [], NOW, NO_QUESTIONS)).toEqual([]);
  });

  it("plans one pane.stalled per idle stretch, not one per poll", () => {
    const events = [...spawnedIdleAt(2), pane(9, "pane.stalled")];
    expect(plannedStalls(events, [], NOW, NO_QUESTIONS)).toEqual([]);
  });

  it("plans a new pane.stalled for a later idle stretch after work resumed", () => {
    const events = [
      ...spawnedIdleAt(2),
      pane(9, "pane.stalled"),
      pane(12, "pane.busy"),
      pane(13, "pane.waiting"),
    ];
    expect(plannedStalls(events, [], NOW, NO_QUESTIONS)).toEqual([STALLED]);
  });
});

describe("plannedStalls: a pane with a background command open", () => {
  it("plans nothing while the pane has a background command open", () => {
    vi.mocked(hasOpenBackground).mockReturnValue(true);
    expect(plannedStalls(spawnedIdleAt(2), [], NOW, NO_QUESTIONS)).toEqual([]);
    expect(hasOpenBackground).toHaveBeenCalledWith(
      expect.any(Array),
      PANE,
      NOW.getTime(),
    );
  });

  it("checks a background command against the pane's RESULT, which herdr records, so a later stuck stretch is not hidden", () => {
    // The pane printed its RESULT before its newest work, so the check runs and must see that RESULT.
    const finished = pane(-1, "pane.finished");
    plannedStalls([finished, ...spawnedIdleAt(2)], [], NOW, NO_QUESTIONS);
    expect(hasOpenBackground).toHaveBeenCalled();
    expect(
      vi
        .mocked(hasOpenBackground)
        .mock.calls.every(([marks]) => marks.includes(finished)),
    ).toBe(true);
  });
});

describe("plannedStalls: a pane waiting on an open reserved question", () => {
  it("plans nothing while the pane waits on an open reserved question it posted", () => {
    vi.mocked(hasOpenQuestion).mockReturnValue(true);
    const questions = [
      { id: "routed-1", kind: "decision.routed" } as LedgerEvent,
    ];
    expect(plannedStalls(spawnedIdleAt(2), [], NOW, questions)).toEqual([]);
    expect(hasOpenQuestion).toHaveBeenCalledWith(
      questions,
      PANE,
      NOW.getTime(),
    );
  });

  it("plans the pane.stalled once the owner has answered its question", () => {
    vi.mocked(hasOpenQuestion).mockReturnValue(false);
    expect(plannedStalls(spawnedIdleAt(2), [], NOW, NO_QUESTIONS)).toEqual([
      STALLED,
    ]);
  });
});

describe("plannedStalls: the detector never reads token-usage events", () => {
  const tokens = (minutes: number): LedgerEvent => ({
    schema: 1,
    id: `token-${minutes}`,
    source: "claude",
    kind: "token.usage",
    occurredAt: new Date(at(minutes)).toISOString(),
    recordedAt: new Date(at(minutes)).toISOString(),
    session: "claude-session-1",
    pane: PANE,
    tokens: 1000,
  });

  it("plans the same pane.stalled with a recent token-usage event as with none", () => {
    expect(
      plannedStalls(spawnedIdleAt(2), [tokens(59)], NOW, NO_QUESTIONS),
    ).toEqual([STALLED]);
  });

  it("passes no token-usage event to the background or question checks", () => {
    plannedStalls(spawnedIdleAt(2), [tokens(0)], NOW, NO_QUESTIONS);
    const seen = vi
      .mocked(hasOpenBackground)
      .mock.calls.flatMap(([marks]) => marks);
    expect(seen.some((e) => e.kind === "token.usage")).toBe(false);
  });
});
