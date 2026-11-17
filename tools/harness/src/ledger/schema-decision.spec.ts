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

describe("the owner.replied event", () => {
  const github = { source: "github", occurredAt: "2026-11-16T12:00:00Z" };

  it("is a kind only the poller writes, read from an untagged owner comment", () => {
    expect(KINDS).toContain("owner.replied");
    expect(POLLER_KINDS).toContain("owner.replied");
  });

  it("records the issue number the owner replied on, and nothing of the reply", () => {
    expect(
      parseEvent({ ...github, kind: "owner.replied", number: 854 }, "input").ok,
    ).toBe(true);
    expect(
      parseEvent(
        {
          ...github,
          kind: "owner.replied",
          number: 854,
          label: "approve",
        },
        "input",
      ),
    ).toMatchObject({ ok: false, field: "label" });
  });

  it("refuses a reply with no issue number, since an open question is closed by it", () => {
    expect(
      parseEvent({ ...github, kind: "owner.replied" }, "input"),
    ).toMatchObject({ ok: false, field: "number" });
  });
});

describe("the decision.routed event a posted question records", () => {
  const claude = { source: "claude", occurredAt: "2026-11-16T12:30:00.000Z" };
  const posted = {
    ...claude,
    kind: "decision.routed",
    idea: "0009",
    label: "naming",
    route: "owner",
    signal: "reserved-category",
  };

  it("records the pane that posted the question and the issue it was posted on", () => {
    expect(
      parseEvent({ ...posted, pane: "w3:p1", number: 854 }, "input").ok,
    ).toBe(true);
  });

  it("still reads a route recorded with neither, as before the question was posted", () => {
    expect(parseEvent(posted, "input").ok).toBe(true);
  });

  it("refuses an issue number that is not a positive integer", () => {
    expect(parseEvent({ ...posted, number: 0 }, "input")).toMatchObject({
      ok: false,
      field: "number",
    });
  });
});
