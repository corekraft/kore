import { describe, expect, it } from "vitest";
import { KINDS, parseEvent, POLLER_KINDS } from "./schema.js";

const stamp = {
  source: "claude",
  kind: "review.run",
  occurredAt: "2026-11-15T10:00:00.000Z",
};

describe("review.run events", () => {
  it("is a ledger kind a person or tool may record, never one only the poller writes", () => {
    expect(KINDS).toContain("review.run");
    expect(POLLER_KINDS).not.toContain("review.run");
  });

  it("carries the PR number and a label naming what the run did", () => {
    expect(
      parseEvent(
        { ...stamp, number: 42, label: "posted:abc1234d", stage: "review" },
        "input",
      ).ok,
    ).toBe(true);
  });

  it("refuses a run recorded with no PR number, or with no label", () => {
    expect(
      parseEvent({ ...stamp, label: "posted:abc1234d" }, "input"),
    ).toMatchObject({
      ok: false,
      field: "number",
    });
    expect(parseEvent({ ...stamp, number: 42 }, "input")).toMatchObject({
      ok: false,
      field: "label",
    });
  });
});
