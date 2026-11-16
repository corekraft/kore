import { describe, expect, it } from "vitest";
import { KINDS, parseEvent, POLLER_KINDS } from "./schema.js";

const stamp = { source: "claude", occurredAt: "2026-11-16T10:00:00.000Z" };

describe("the decision.made event", () => {
  it("is a kind a tool may record, never one only the poller writes", () => {
    expect(KINDS).toContain("decision.made");
    expect(POLLER_KINDS).not.toContain("decision.made");
  });

  it("records a decision with the idea and its category", () => {
    expect(
      parseEvent(
        { ...stamp, kind: "decision.made", idea: "0008", label: "naming" },
        "input",
      ).ok,
    ).toBe(true);
  });

  it("refuses a decision with no category, since the label is where it is recorded", () => {
    expect(
      parseEvent({ ...stamp, kind: "decision.made", idea: "0008" }, "input"),
    ).toMatchObject({ ok: false, field: "label" });
  });

  it("refuses question or reasoning text, which stays on the issue", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "decision.made",
          idea: "0008",
          label: "naming",
          question: "Median or P50?",
        },
        "input",
      ),
    ).toMatchObject({ ok: false, field: "question" });
  });
});
