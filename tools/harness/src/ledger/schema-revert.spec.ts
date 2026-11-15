import { describe, expect, it } from "vitest";
import { KINDS, POLLER_KINDS, parseEvent } from "./schema.js";

const event = {
  source: "claude",
  kind: "harness-change-reverted",
  occurredAt: "2026-01-02T03:04:05.000Z",
};

describe("the harness-change-reverted ledger event", () => {
  it("carries the revert PR number and requires it", () => {
    expect(parseEvent({ ...event, number: 9 }, "input").ok).toBe(true);
    expect(parseEvent(event, "input").ok).toBe(false);
  });

  it("takes no label", () => {
    expect(parseEvent({ ...event, number: 9, label: "x" }, "input").ok).toBe(
      false,
    );
  });

  it("is written by an agent through ledger record, never by the poller", () => {
    expect(KINDS).toContain("harness-change-reverted");
    expect(POLLER_KINDS).not.toContain("harness-change-reverted");
  });
});
