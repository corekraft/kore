import { describe, expect, it } from "vitest";
import { KINDS, parseEvent, POLLER_KINDS } from "./schema.js";

const stamp = { source: "claude", occurredAt: "2026-11-16T10:00:00.000Z" };

describe("the decision.made event", () => {
  it("is a kind a tool may record, never one only the poller writes", () => {
    expect(KINDS).toContain("decision.made");
    expect(POLLER_KINDS).not.toContain("decision.made");
  });

  it("records a decision with the idea and its category, as decisions recorded before the issue number did", () => {
    expect(
      parseEvent(
        { ...stamp, kind: "decision.made", idea: "0008", label: "naming" },
        "input",
      ).ok,
    ).toBe(true);
  });

  it("records the issue number a decision was posted on, so its overturns can be read", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "decision.made",
          idea: "0008",
          label: "naming",
          number: 795,
        },
        "input",
      ).ok,
    ).toBe(true);
  });

  it("refuses an issue number that is not a positive integer", () => {
    expect(
      parseEvent(
        {
          ...stamp,
          kind: "decision.made",
          idea: "0008",
          label: "naming",
          number: 0,
        },
        "input",
      ),
    ).toMatchObject({ ok: false, field: "number" });
  });
});

describe("the decision.made event's label and content", () => {
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

describe("the advisor.overturned event", () => {
  const github = { source: "github", occurredAt: "2026-11-16T11:00:00Z" };

  it("is a kind only the poller writes, read from GitHub's comments", () => {
    expect(KINDS).toContain("advisor.overturned");
    expect(POLLER_KINDS).toContain("advisor.overturned");
  });

  it("records an overturn with the issue number and its idea", () => {
    expect(
      parseEvent(
        { ...github, kind: "advisor.overturned", number: 862, idea: "#862" },
        "input",
      ).ok,
    ).toBe(true);
  });

  it("refuses an overturn with no issue number, since the figure counts by it", () => {
    expect(
      parseEvent(
        { ...github, kind: "advisor.overturned", idea: "#862" },
        "input",
      ),
    ).toMatchObject({ ok: false, field: "number" });
  });
});
