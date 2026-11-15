import { describe, expect, it } from "vitest";
import { TIER_RULES, TIER_SOURCES } from "./schema-tier.js";

const rule = (field: string) => {
  const found = TIER_RULES.find((candidate) => candidate.field === field);
  if (found === undefined) {
    throw new Error(`no rule for ${field}`);
  }
  return found;
};

describe("tier source rules", () => {
  it("names the three places a tier can come from", () => {
    expect(TIER_SOURCES).toEqual(["definition", "escalation", "override"]);
  });

  it("covers tierSource and tierReason, both optional and on session.launch only", () => {
    expect(TIER_RULES.map((r) => r.field)).toEqual([
      "tierSource",
      "tierReason",
    ]);
    for (const r of TIER_RULES) {
      expect(r.kinds).toEqual(["session.launch"]);
      expect(r.optional).toBe(true);
    }
  });

  it("accepts only a known tier source", () => {
    expect(rule("tierSource").check("override")).toBe(true);
    expect(rule("tierSource").check("guess")).toBe(false);
    expect(rule("tierSource").check(undefined)).toBe(false);
  });

  it("accepts a reason of 1 to 100 characters with no control characters", () => {
    expect(rule("tierReason").check("judge needs more depth")).toBe(true);
    expect(rule("tierReason").check("")).toBe(false);
    expect(rule("tierReason").check("x".repeat(101))).toBe(false);
    expect(rule("tierReason").check("two\nlines")).toBe(false);
    expect(rule("tierReason").check(7)).toBe(false);
  });
});
