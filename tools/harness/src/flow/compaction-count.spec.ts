// The compaction count in the flow report (#1037, spec #1027): session.compacted readings
// totalled per session and over the window. A window with no session is insufficient and
// never a zero. Real flow module; the events are fixtures.

import { describe, expect, it } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { compactionCount } from "./compaction-count.js";
import type { Span } from "./scope.js";

const DAY = 86_400_000;
/** The report window is the eleventh day, open at the start and closed at the end. */
const WINDOW: Span = [10 * DAY, 11 * DAY];

/** An event at `ms`; its id and times read back as `ms`. */
function event(
  ms: number,
  kind: Kind,
  session: string,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: `${kind}:${session}:${ms}`,
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    session,
    ...extra,
  } satisfies LedgerEvent;
}

const compacted = (ms: number, session: string, compaction: number) =>
  event(ms, "session.compacted", session, { compaction });
const started = (ms: number, session: string) =>
  event(ms, "session.start", session);

describe("compactionCount totals compactions per session and per window", () => {
  it("totals the window's compactions and gives each session its own count", () => {
    const events = [
      started(10 * DAY + 1, "a"),
      started(10 * DAY + 2, "b"),
      compacted(10 * DAY + 10, "a", 1),
      compacted(10 * DAY + 20, "a", 2),
      compacted(10 * DAY + 30, "b", 1),
    ];

    expect(compactionCount(events, WINDOW)).toEqual({
      status: "ok",
      compactions: 3,
      sessions: 2,
      perSession: { a: 2, b: 1 },
    });
  });

  it("counts a session that never compacted as zero beside the ones that did, since it was seen", () => {
    const events = [
      started(10 * DAY + 1, "a"),
      started(10 * DAY + 2, "b"),
      compacted(10 * DAY + 10, "a", 1),
    ];

    expect(compactionCount(events, WINDOW)).toEqual({
      status: "ok",
      compactions: 1,
      sessions: 2,
      perSession: { a: 1, b: 0 },
    });
  });

  it("counts a compaction whose session start fell before the window, since the session is seen", () => {
    const events = [started(9 * DAY, "a"), compacted(10 * DAY + 10, "a", 3)];

    expect(compactionCount(events, WINDOW)).toEqual({
      status: "ok",
      compactions: 1,
      sessions: 1,
      perSession: { a: 1 },
    });
  });

  it("leaves out compactions before the window opens and at or after it closes", () => {
    const events = [
      started(10 * DAY + 1, "a"),
      compacted(10 * DAY - 1, "a", 1),
      compacted(10 * DAY, "a", 2),
      compacted(11 * DAY, "a", 3),
    ];

    expect(compactionCount(events, WINDOW)).toEqual({
      status: "ok",
      compactions: 1,
      sessions: 1,
      perSession: { a: 1 },
    });
  });

  it("counts a compaction recorded twice for one session and number once", () => {
    const events = [
      compacted(10 * DAY + 10, "a", 1),
      compacted(10 * DAY + 11, "a", 1),
    ];

    expect(compactionCount(events, WINDOW)).toEqual({
      status: "ok",
      compactions: 1,
      sessions: 1,
      perSession: { a: 1 },
    });
  });
});

describe("compactionCount never prints a zero for a window it cannot read", () => {
  it("is insufficient, with its reason, for a window with no session", () => {
    expect(compactionCount([], WINDOW)).toEqual({
      status: "insufficient",
      reason: "no session recorded in the window",
    });
  });

  it("is insufficient when the only sessions fall outside the window", () => {
    const events = [started(9 * DAY, "a"), compacted(11 * DAY, "a", 1)];

    expect(compactionCount(events, WINDOW)).toEqual({
      status: "insufficient",
      reason: "no session recorded in the window",
    });
  });
});
