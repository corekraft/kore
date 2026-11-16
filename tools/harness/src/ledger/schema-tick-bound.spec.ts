import { describe, expect, it } from "vitest";
import { KINDS, parseEvent, POLLER_KINDS } from "./schema.js";

const stamp = { source: "claude", occurredAt: "2026-11-16T10:00:00.000Z" };

describe("tick bound events", () => {
  it("are a kind the tick may record, never one only the poller writes", () => {
    expect(KINDS).toContain("tick.bound");
    expect(POLLER_KINDS).not.toContain("tick.bound");
  });

  it("records a bound hit with the idea and the bound it names", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "tick.bound",
          idea: "#872",
          label: "on battery: one pane starts per pass",
        },
        "input",
      ).ok,
    ).toBe(true);
  });

  it("refuses a bound hit whose label has a control character", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "tick.bound",
          idea: "#872",
          label: "load\nhigh",
        },
        "input",
      ),
    ).toMatchObject({ ok: false, field: "label" });
  });
});
