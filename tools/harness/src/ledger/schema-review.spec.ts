import { describe, expect, it } from "vitest";
import { parseEvent } from "./schema.js";

const review = {
  source: "claude",
  kind: "review.run",
  occurredAt: "2026-01-02T03:04:05.000Z",
  number: 42,
  label: "posted:abcdef12",
};

describe("the findings count on a review.run event", () => {
  it("is accepted on a review.run event as a whole number of findings, zero for a clean review", () => {
    expect(parseEvent({ ...review, findings: 0 }, "input")).toEqual({
      ok: true,
      event: { ...review, findings: 0 },
    });
    expect(parseEvent({ ...review, findings: 3 }, "input")).toEqual({
      ok: true,
      event: { ...review, findings: 3 },
    });
  });

  it("is optional, so a review.run from before the verdict was recorded still parses", () => {
    expect(parseEvent(review, "input")).toEqual({ ok: true, event: review });
  });

  it("refuses a negative or fractional count, and names the field", () => {
    for (const findings of [-1, 1.5]) {
      expect(parseEvent({ ...review, findings }, "input")).toEqual({
        ok: false,
        field: "findings",
        message:
          'Invalid event: field "findings" must be a whole number, 0 or more.',
      });
    }
  });

  it("is refused on any other kind of event", () => {
    const send = {
      source: "github",
      kind: "send-back",
      occurredAt: "2026-01-02T03:04:05.000Z",
      number: 42,
      label: "too slow @abcdef1",
      findings: 2,
    };
    expect(parseEvent(send, "input")).toEqual({
      ok: false,
      field: "findings",
      message:
        'Invalid event: field "findings" is only allowed on review.run events.',
    });
  });
});

describe("the cited rule labels on a review.run event", () => {
  it("is accepted as comma-separated short labels", () => {
    const rules = "tests-describe-behavior,errors-are-actionable";
    expect(parseEvent({ ...review, findings: 2, rules }, "input")).toEqual({
      ok: true,
      event: { ...review, findings: 2, rules },
    });
  });

  it("is optional, so a review.run recorded without labels still parses", () => {
    expect(parseEvent({ ...review, findings: 0 }, "input").ok).toBe(true);
  });

  it("refuses a label longer than the fixed length, so verdict text cannot ride in it", () => {
    const rules = "a".repeat(33);
    expect(parseEvent({ ...review, findings: 1, rules }, "input")).toEqual({
      ok: false,
      field: "rules",
      message:
        'Invalid event: field "rules" must be 1 to 10 comma-separated labels of at most 32 lowercase letters, digits or -.',
    });
  });

  it("refuses spaces, uppercase, an empty label and more than ten labels", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `r${i}`).join(",");
    for (const rules of ["two words", "Upper", "a,,b", "", eleven]) {
      expect(
        parseEvent({ ...review, findings: 1, rules }, "input"),
      ).toMatchObject({ ok: false, field: "rules" });
    }
  });

  it("is refused on any other kind of event", () => {
    const send = {
      source: "github",
      kind: "send-back",
      occurredAt: "2026-01-02T03:04:05.000Z",
      number: 42,
      label: "too slow @abcdef1",
      rules: "scope",
    };
    expect(parseEvent(send, "input")).toEqual({
      ok: false,
      field: "rules",
      message:
        'Invalid event: field "rules" is only allowed on review.run events.',
    });
  });
});
