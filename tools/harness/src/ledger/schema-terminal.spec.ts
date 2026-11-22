import { describe, expect, it } from "vitest";
import { SOURCES, parseEvent } from "./schema.js";

const pane = {
  source: "terminal",
  kind: "pane.busy",
  occurredAt: "2026-11-22T10:00:00.000Z",
  pane: "t2",
  session: "s1",
};

function rejected(input: unknown, mode: "input" | "stored" = "input") {
  const result = parseEvent(input, mode);
  if (result.ok) {
    throw new Error("expected the event to be rejected");
  }
  return result;
}

describe("ledger source terminal", () => {
  it("is a source the schema accepts, and herdr stays one", () => {
    expect(SOURCES).toContain("terminal");
    expect(SOURCES).toContain("herdr");
  });

  it("accepts a terminal event carrying its status and turn, and keeps both", () => {
    const event = { ...pane, status: "working", turn: 3 };
    expect(parseEvent(event, "input")).toEqual({ ok: true, event });
  });

  it("reads a stored herdr line with no status or turn, as every older line is", () => {
    const stored = {
      schema: 1,
      id: "e1",
      source: "herdr",
      kind: "pane.waiting",
      occurredAt: "2026-11-22T10:00:00.000Z",
      recordedAt: "2026-11-22T10:00:01.000Z",
      pane: "w1:p2",
      agent: "claude",
    };
    expect(parseEvent(stored, "stored")).toEqual({ ok: true, event: stored });
  });

  it.each([
    "idle",
    "working",
    "done",
    "blocked",
    "error",
    "finished",
    "unreported",
  ])("accepts the status %s", (status) => {
    expect(parseEvent({ ...pane, status }, "input").ok).toBe(true);
  });

  it("refuses a status that is not one the watch records", () => {
    expect(rejected({ ...pane, status: "running" })).toMatchObject({
      field: "status",
    });
  });

  it.each([-1, 1.5, "3"])(
    "refuses the turn %j: a turn is a non-negative integer",
    (turn) => {
      expect(rejected({ ...pane, turn })).toMatchObject({ field: "turn" });
    },
  );

  it("accepts turn 0, the first turn of a terminal", () => {
    expect(parseEvent({ ...pane, turn: 0 }, "input").ok).toBe(true);
  });
});
