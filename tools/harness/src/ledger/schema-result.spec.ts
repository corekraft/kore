import { describe, expect, it } from "vitest";
import { parseEvent } from "./schema.js";

const OCCURRED = "2026-01-02T03:04:05.000Z";

function rejected(input: unknown) {
  const result = parseEvent(input, "input");
  if (result.ok) {
    throw new Error("expected the event to be rejected");
  }
  return result;
}

describe("session.result carries only the outcome word", () => {
  const stop = {
    source: "claude",
    kind: "session.result",
    occurredAt: OCCURRED,
    session: "claude-session-1",
    pane: "w3:p9",
    result: "done",
  };

  it("accepts a session.result whose only payload is the outcome word", () => {
    expect(parseEvent(stop, "input")).toEqual({ ok: true, event: stop });
  });

  it("refuses a session.result whose outcome is not done or blocked", () => {
    expect(rejected({ ...stop, result: "merged" })).toEqual({
      ok: false,
      field: "result",
      message: 'Invalid event: field "result" must be one of done, blocked.',
    });
  });

  it("refuses a session.result with no outcome word", () => {
    expect(rejected({ ...stop, result: undefined })).toEqual({
      ok: false,
      field: "result",
      message:
        'Invalid event: field "result" is required on session.result events.',
    });
  });

  it("refuses the result field on a kind that does not carry one", () => {
    expect(rejected({ ...stop, kind: "session.stop", result: "done" })).toEqual(
      {
        ok: false,
        field: "result",
        message:
          'Invalid event: field "result" is only allowed on session.result and pane.finished events.',
      },
    );
  });
});

describe("pane.finished records the RESULT line a session wait saw", () => {
  const finished = {
    source: "herdr",
    kind: "pane.finished",
    occurredAt: OCCURRED,
    pane: "w3:p9",
    agent: "image-trust-writer",
    result: "blocked",
  };

  it("accepts a pane.finished with its pane, session name and outcome word", () => {
    expect(parseEvent(finished, "input")).toEqual({
      ok: true,
      event: finished,
    });
  });

  it("refuses a pane.finished with no outcome word", () => {
    expect(rejected({ ...finished, result: undefined })).toEqual({
      ok: false,
      field: "result",
      message:
        'Invalid event: field "result" is required on pane.finished events.',
    });
  });
});
