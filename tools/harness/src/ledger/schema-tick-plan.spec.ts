import { describe, expect, it } from "vitest";
import { KINDS, parseEvent, POLLER_KINDS } from "./schema.js";

const stamp = { source: "claude", occurredAt: "2026-11-17T10:00:00.000Z" };

describe("tick plan events", () => {
  it("are a kind the tick may record, never one only the poller writes", () => {
    expect(KINDS).toContain("tick.plan");
    expect(POLLER_KINDS).not.toContain("tick.plan");
  });

  it("records a recorded work plan with its idea and its piece count", () => {
    expect(
      parseEvent(
        { ...stamp, kind: "tick.plan", idea: "0007", number: 2 },
        "input",
      ),
    ).toEqual({
      ok: true,
      event: { ...stamp, kind: "tick.plan", idea: "0007", number: 2 },
    });
  });

  it("refuses the plan's text, since the ledger holds no brief or prompt", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "tick.plan",
          idea: "0007",
          number: 1,
          brief: "Split the retry logic out first.",
        },
        "input",
      ),
    ).toMatchObject({ ok: false, field: "brief" });
  });
});
