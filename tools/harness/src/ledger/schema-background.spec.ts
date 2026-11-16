import { describe, expect, it } from "vitest";
import { parseEvent } from "./schema.js";

const OCCURRED = "2026-01-02T03:04:05.000Z";

const start = {
  source: "claude",
  kind: "tool.start",
  occurredAt: OCCURRED,
  session: "claude-session-1",
  pane: "w3:p9",
  tool: "Bash",
};

describe("tool.start may mark a background command", () => {
  it("accepts a tool.start that marks its command as background", () => {
    const marked = { ...start, background: true };
    expect(parseEvent(marked, "input")).toEqual({ ok: true, event: marked });
  });

  it("accepts a tool.start with no background mark, as every foreground call has none", () => {
    expect(parseEvent(start, "input")).toEqual({ ok: true, event: start });
  });

  it("refuses a background mark that is not true", () => {
    expect(parseEvent({ ...start, background: false }, "input")).toEqual({
      ok: false,
      field: "background",
      message: 'Invalid event: field "background" must be true when present.',
    });
  });

  it("refuses the background mark on a tool.end, which never marks a command", () => {
    expect(
      parseEvent(
        { ...start, kind: "tool.end", outcome: "success", background: true },
        "input",
      ),
    ).toEqual({
      ok: false,
      field: "background",
      message:
        'Invalid event: field "background" is only allowed on tool.start events.',
    });
  });
});

describe("pane.stalled is a pane event the poll records", () => {
  it("accepts a pane.stalled from herdr with its pane and agent", () => {
    const stalled = {
      source: "herdr",
      kind: "pane.stalled",
      occurredAt: OCCURRED,
      pane: "w3:p9",
      agent: "writer",
    };
    expect(parseEvent(stalled, "input")).toEqual({ ok: true, event: stalled });
  });
});
