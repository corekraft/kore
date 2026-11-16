import { describe, expect, it } from "vitest";
import { POLLER_KINDS, parseEvent } from "./schema.js";

const stamp = {
  source: "claude",
  occurredAt: "2026-01-02T03:04:05.000Z",
  session: "s1",
};

describe("guardrail events", () => {
  it("guardrail.requested carries the rule and the change as its label and nothing else", () => {
    const event = { ...stamp, kind: "guardrail.requested" };
    expect(
      parseEvent({ ...event, label: "bare-glob:audit>enforce" }, "input").ok,
    ).toBe(true);
    expect(parseEvent(event, "input").ok).toBe(false);
    expect(
      parseEvent({ ...event, label: "r:audit>enforce", number: 3 }, "input").ok,
    ).toBe(false);
    expect(POLLER_KINDS).not.toContain("guardrail.requested");
  });

  it("guardrail.approval-warned carries the approved change as its label and nothing else", () => {
    const event = { ...stamp, kind: "guardrail.approval-warned" };
    expect(
      parseEvent({ ...event, label: "bare-glob:audit>enforce" }, "input").ok,
    ).toBe(true);
    expect(parseEvent(event, "input").ok).toBe(false);
    expect(
      parseEvent({ ...event, label: "r:audit>enforce", number: 3 }, "input").ok,
    ).toBe(false);
    expect(POLLER_KINDS).not.toContain("guardrail.approval-warned");
  });

  it("guardrail.activated carries the rule and the approved change as its label and nothing else", () => {
    const event = { ...stamp, kind: "guardrail.activated" };
    expect(
      parseEvent({ ...event, label: "bare-glob:audit>enforce" }, "input").ok,
    ).toBe(true);
    expect(parseEvent(event, "input").ok).toBe(false);
    expect(
      parseEvent({ ...event, label: "r:audit>enforce", number: 3 }, "input").ok,
    ).toBe(false);
    expect(POLLER_KINDS).not.toContain("guardrail.activated");
  });
});
