import { describe, expect, it } from "vitest";
import { KINDS, parseEvent } from "./schema.js";

const checked = {
  source: "github",
  kind: "pr.checked",
  occurredAt: "2026-11-16T10:00:00.000Z",
  label: "declaration,failed-check",
};

describe("ledger event schema, pr.checked", () => {
  it("is a kind the ledger offers", () => {
    expect(KINDS).toContain("pr.checked");
  });

  it("requires the PR number it checked", () => {
    const result = parseEvent(checked, "input");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.field).toBe("number");
  });

  it("accepts the PR number with its failure categories as the label", () => {
    expect(parseEvent({ ...checked, number: 12 }, "input")).toEqual({
      ok: true,
      event: { ...checked, number: 12 },
    });
  });
});
