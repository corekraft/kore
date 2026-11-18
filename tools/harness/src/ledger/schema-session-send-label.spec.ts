import { describe, expect, it } from "vitest";
import { parseEvent } from "./schema.js";

const stamp = { source: "claude", occurredAt: "2026-11-17T10:00:00.000Z" };

describe("session send events for a tick notice", () => {
  it("records the idea and the state a person was told about, with the tick as sender", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "session.send",
          pane: "w3:p1",
          idea: "0034",
          label: "needs-info",
          senderRole: "tick",
          senderName: "orchestrator-tick",
        },
        "input",
      ),
    ).toMatchObject({ ok: true });
  });

  it("refuses a state label with a control character", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "session.send",
          pane: "w3:p1",
          idea: "0034",
          label: "needs\ninfo",
        },
        "input",
      ),
    ).toMatchObject({ ok: false, field: "label" });
  });
});
