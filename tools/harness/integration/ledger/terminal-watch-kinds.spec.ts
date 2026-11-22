// The ledger watch's planner and the ledger schema, run together (plan 16, Step 4 (e)): every event the planner
// can emit must parse as a stored event, or the real ledger refuses it and the watch stops on its first record.
import { describe, expect, it } from "vitest";
import {
  lastReadings,
  parseEvent,
  planTerminals,
} from "../../src/ledger/index.js";
import type { Status, Terminal } from "../../src/terminal/index.js";

const AT = "2026-11-22T10:00:00.000Z";

/** A session terminal in a state the planner reads: live with a status, live with none, or finished. */
function terminal(overrides: Partial<Terminal>): Terminal {
  return {
    id: "t2",
    state: "live",
    labels: { "kore-session": "s1" },
    cwd: "/work",
    turn: 0,
    ...overrides,
  };
}

describe("every event the ledger watch plans parses as a stored terminal event", () => {
  const cases: Array<[string, Partial<Terminal>]> = [
    ["working", { status: "working" }],
    ["idle", { status: "idle" }],
    ["done", { status: "done" }],
    ["blocked", { status: "blocked" }],
    ["error", { status: "error" }],
    ["unreported", {}],
    ["finished", { state: "finished", status: "working", exitCode: 0 }],
  ];

  it.each(cases)(
    "a %s terminal plans an event the schema accepts",
    (_name, overrides) => {
      const { events } = planTerminals(
        [terminal(overrides)],
        lastReadings([]),
        AT,
      );
      expect(events).toHaveLength(1);
      for (const event of events) {
        expect(parseEvent(event, "input").ok).toBe(true);
      }
    },
  );

  it("a finish parses with its status and turn, and no result", () => {
    const { events } = planTerminals(
      [terminal({ state: "finished", status: "working" as Status })],
      lastReadings([]),
      AT,
    );
    expect(parseEvent(events[0], "input")).toEqual({
      ok: true,
      event: {
        source: "terminal",
        kind: "pane.finished",
        occurredAt: AT,
        pane: "t2",
        session: "s1",
        status: "finished",
        turn: 0,
      },
    });
  });
});
