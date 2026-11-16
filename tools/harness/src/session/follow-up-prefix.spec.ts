import { describe, expect, it } from "vitest";
import { FOLLOW_UP_PREFIX, withFollowUpPrefix } from "./follow-up-prefix.js";

describe("the follow-up prefix", () => {
  it("keeps the literal text past transcripts carry", () => {
    expect(FOLLOW_UP_PREFIX).toBe("[orchestrator]");
  });

  it("adds the prefix to a message that lacks it", () => {
    expect(withFollowUpPrefix("Rebase on main")).toBe(
      "[orchestrator] Rebase on main",
    );
  });

  it.each([
    "[orchestrator] Rebase on main",
    "  [orchestrator]   Rebase on main",
    "[ORCHESTRATOR] Rebase on main",
  ])(
    "carries the prefix exactly once when the caller typed it: %s",
    (typed) => {
      expect(withFollowUpPrefix(typed)).toBe("[orchestrator] Rebase on main");
    },
  );

  it("does not strip the tag when it appears mid-sentence", () => {
    expect(withFollowUpPrefix("Never edit the [orchestrator] brief")).toBe(
      "[orchestrator] Never edit the [orchestrator] brief",
    );
  });
});
