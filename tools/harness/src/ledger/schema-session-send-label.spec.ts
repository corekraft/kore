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

describe("session events an hc terminal writes", () => {
  const fromTerminal = {
    source: "terminal",
    occurredAt: "2026-11-22T10:00:00.000Z",
  };

  it("accepts a session.send from a terminal, and a pane.closed that closes one", () => {
    expect(
      parseEvent(
        {
          ...fromTerminal,
          kind: "session.send",
          pane: "t3",
          agent: "image-trust-writer",
          senderRole: "writer",
          senderName: "pair-a-reader",
        },
        "input",
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseEvent(
        {
          ...fromTerminal,
          kind: "pane.closed",
          pane: "t3",
          agent: "image-trust-writer",
        },
        "input",
      ),
    ).toMatchObject({ ok: true });
  });
});
