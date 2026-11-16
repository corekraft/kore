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

describe("session.send records the sender's role and name", () => {
  it("accepts a session.send carrying the sender's role and name", () => {
    expect(
      parseEvent(
        { ...sent, senderRole: "writer", senderName: "pane-message-sender" },
        "input",
      ),
    ).toEqual({
      ok: true,
      event: {
        ...sent,
        senderRole: "writer",
        senderName: "pane-message-sender",
      },
    });
  });

  it("still accepts a session.send with no sender, as a send from before the fields existed", () => {
    expect(parseEvent(sent, "input")).toEqual({ ok: true, event: sent });
  });

  it("refuses a sender role that is not a name the ledger can hold", () => {
    expect(rejected({ ...sent, senderRole: "Writer Role" })).toMatchObject({
      ok: false,
      field: "senderRole",
    });
  });

  it("refuses a sender name that is not a name the ledger can hold", () => {
    expect(rejected({ ...sent, senderName: "x".repeat(129) })).toMatchObject({
      ok: false,
      field: "senderName",
    });
  });

  it.each(["senderRole", "senderName"])(
    "refuses %s on a session.start event, which does not send a message",
    (field) => {
      expect(
        rejected({
          source: "claude",
          kind: "session.start",
          occurredAt: "2026-01-02T03:04:05.000Z",
          [field]: "writer",
        }),
      ).toMatchObject({ ok: false, field });
    },
  );
});
