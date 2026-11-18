// The session.compacted reading (#1037, spec #1027): one event per compaction of a session,
// holding the session's name and the compaction's number, never text. Real schema module.

import { describe, expect, it } from "vitest";
import { parseEvent } from "./schema.js";

const compacted = {
  source: "claude",
  kind: "session.compacted",
  occurredAt: "2026-01-02T03:04:05.000Z",
  session: "abc",
  id: "compaction:abc:2",
  compaction: 2,
};

function rejected(input: unknown) {
  const result = parseEvent(input, "input");
  if (result.ok) {
    throw new Error("expected the event to be rejected");
  }
  return result;
}

describe("session.compacted records the number of a session's compaction", () => {
  it("accepts a compaction reading holding the session name and the compaction's number", () => {
    expect(parseEvent(compacted, "input")).toEqual({
      ok: true,
      event: compacted,
    });
  });

  it("requires the compaction number, so a reading is never an empty count", () => {
    const { compaction: _omitted, ...without } = compacted;

    expect(rejected(without)).toMatchObject({
      ok: false,
      field: "compaction",
      message:
        'Invalid event: field "compaction" is required on session.compacted events.',
    });
  });

  it.each([0, -1, 1.5, "2", null])(
    "refuses %j as a compaction number: it must be a positive whole number",
    (value) => {
      expect(rejected({ ...compacted, compaction: value })).toMatchObject({
        ok: false,
        field: "compaction",
      });
    },
  );

  it("refuses a compaction number on a kind that is not a compaction", () => {
    expect(
      rejected({
        source: "claude",
        kind: "session.start",
        occurredAt: "2026-01-02T03:04:05.000Z",
        compaction: 1,
      }),
    ).toMatchObject({
      ok: false,
      field: "compaction",
      message:
        'Invalid event: field "compaction" is only allowed on session.compacted events.',
    });
  });

  it("refuses a field that would carry text, so the reading stays numbers and names only", () => {
    expect(
      rejected({ ...compacted, summary: "the compacted conversation" }),
    ).toMatchObject({ ok: false, field: "summary" });
  });
});
