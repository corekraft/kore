import { describe, expect, it } from "vitest";
import { parseEvent } from "./schema.js";

const sent = {
  source: "herdr",
  kind: "session.send",
  occurredAt: "2026-01-02T03:04:05.000Z",
  pane: "w3:p9",
  agent: "image-trust-writer",
};

function rejected(input: unknown) {
  const result = parseEvent(input, "input");
  if (result.ok) {
    throw new Error("expected the event to be rejected");
  }
  return result;
}

describe("session.send records a handover reason from a fixed list", () => {
  it("accepts a main-session send carrying a handover reason from the list", () => {
    expect(
      parseEvent({ ...sent, handover: "needs-info-idea" }, "input"),
    ).toEqual({
      ok: true,
      event: { ...sent, handover: "needs-info-idea" },
    });
  });

  it("still accepts a session.send with no handover reason, as an ordinary send", () => {
    expect(parseEvent(sent, "input")).toEqual({ ok: true, event: sent });
  });

  it("refuses a handover reason outside the list, so no message text reaches the ledger", () => {
    expect(
      rejected({ ...sent, handover: "please merge my pull request now" }),
    ).toMatchObject({
      ok: false,
      field: "handover",
      message: expect.stringContaining("must be one of reserved-item"),
    });
  });

  it("refuses a handover reason on a kind that is not a send", () => {
    expect(
      rejected({
        source: "claude",
        kind: "session.start",
        occurredAt: "2026-01-02T03:04:05.000Z",
        handover: "owner-request",
      }),
    ).toMatchObject({ ok: false, field: "handover" });
  });
});
