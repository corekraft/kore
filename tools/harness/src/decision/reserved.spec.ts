import { describe, expect, it } from "vitest";
import { RESERVED_CATEGORIES, reservedCategory } from "./reserved.js";

describe("reservedCategory", () => {
  it.each([
    ["destruction", "Should I delete the old cluster profile?"],
    ["destruction", "Is it fine to force-push over the branch?"],
    ["guardrail-mode", "Should the guardrail move to enforce mode?"],
    ["credentials", "Which token should the Reviewer use?"],
    ["credentials", "Do we rotate the age key this week?"],
    ["external-and-spend", "Can we open an account with the new vendor?"],
    ["external-and-spend", "This adds a paid subscription; is that fine?"],
    ["flag-activation", "Should I turn the decision-advisor flag on?"],
    ["flag-activation", "Run flag activate for automatic-retro?"],
    ["dispatch-and-merge", "May I dispatch the release workflow?"],
    ["dispatch-and-merge", "Should I merge PR #902 now?"],
    ["idea-approval", "Do we approve the new idea 0012?"],
    ["adr-reversal", "Should we supersede ADR 0117 with a new one?"],
    ["parked", "Can we restore pre-commit now?"],
    ["advisor-own", "Should the advisor's reserved list gain a category?"],
    ["advisor-own", "Edit .claude/agents/advisor.md to change the tier?"],
  ])("names %s for %j", (category, question) => {
    expect(reservedCategory(question)).toBe(category);
  });

  it.each([
    "Should the flow report name the column Median or P50?",
    "Use a Map or a plain object for the lookup table?",
    "Rename the helper to formatLine or keep the old name?",
  ])("names no category for the unreserved question %j", (question) => {
    expect(reservedCategory(question)).toBeUndefined();
  });

  it("matches without regard to case", () => {
    expect(reservedCategory("DELETE THE CLUSTER?")).toBe("destruction");
  });

  it("keeps one entry per category, so the list stays closed and unambiguous", () => {
    const names = RESERVED_CATEGORIES.map((entry) => entry.category);
    expect(new Set(names).size).toBe(names.length);
  });
});
