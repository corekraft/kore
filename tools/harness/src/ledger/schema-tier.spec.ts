import { describe, expect, it } from "vitest";
import {
  EFFORT_RULES,
  EFFORTS,
  TIER_RULES,
  TIER_SOURCES,
} from "./schema-tier.js";

const rule = (field: string) => {
  const found = TIER_RULES.find((candidate) => candidate.field === field);
  if (found === undefined) {
    throw new Error(`no rule for ${field}`);
  }
  return found;
};

const effortRule = () => {
  const found = EFFORT_RULES.find((candidate) => candidate.field === "effort");
  if (found === undefined) {
    throw new Error("no rule for effort");
  }
  return found;
};

describe("effort rule", () => {
  it("names the five levels the claude CLI's --effort flag accepts", () => {
    expect(EFFORTS).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("covers effort alone, optional and on session.launch only", () => {
    expect(EFFORT_RULES.map((r) => r.field)).toEqual(["effort"]);
    expect(effortRule().kinds).toEqual(["session.launch"]);
    expect(effortRule().optional).toBe(true);
  });

  it("accepts each level the spawn can set", () => {
    for (const level of EFFORTS) {
      expect(effortRule().check(level)).toBe(true);
    }
  });

  it("refuses a value that is not a level the spawn can set", () => {
    expect(effortRule().check("ultra")).toBe(false);
    expect(effortRule().check("High")).toBe(false);
    expect(effortRule().check("")).toBe(false);
    expect(effortRule().check(undefined)).toBe(false);
    expect(effortRule().check(3)).toBe(false);
  });
});

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
