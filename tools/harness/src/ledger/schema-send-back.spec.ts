import { describe, expect, it } from "vitest";
import { parseEvent } from "./schema.js";
import { SEND_BACK_CATEGORIES } from "./schema-send-back.js";

const sendBack = {
  source: "github",
  kind: "send-back",
  occurredAt: "2026-01-02T03:04:05.000Z",
  number: 42,
  label: "too slow @abcdef1",
};

describe("the send-back category on a ledger event", () => {
  it("lists the eight categories, in the order the judge is told them", () => {
    expect(SEND_BACK_CATEGORIES).toEqual([
      "declaration",
      "pattern-mismatch",
      "failed-check",
      "conflict",
      "missing-proof",
      "rule-break",
      "scope",
      "other",
    ]);
  });

  it("is accepted on a send-back event when it names a listed category", () => {
    expect(parseEvent({ ...sendBack, category: "conflict" }, "input")).toEqual({
      ok: true,
      event: { ...sendBack, category: "conflict" },
    });
  });

  it("is optional, so a send-back from before categories existed still parses", () => {
    expect(parseEvent(sendBack, "input")).toEqual({
      ok: true,
      event: sendBack,
    });
  });

  it("refuses a category that is not on the list, and names the field", () => {
    const result = parseEvent({ ...sendBack, category: "misc" }, "input");
    expect(result).toEqual({
      ok: false,
      field: "category",
      message:
        'Invalid event: field "category" must be one of declaration, pattern-mismatch, failed-check, conflict, missing-proof, rule-break, scope, other.',
    });
  });

  it("is refused on any other kind of event", () => {
    const escalation = {
      source: "claude",
      kind: "escalation",
      occurredAt: "2026-01-02T03:04:05.000Z",
      number: 42,
      label: "writer relaunched",
      category: "other",
    };
    expect(parseEvent(escalation, "input")).toEqual({
      ok: false,
      field: "category",
      message:
        'Invalid event: field "category" is only allowed on send-back events.',
    });
  });
});
