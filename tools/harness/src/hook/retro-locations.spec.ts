// Locations the retro scan reports per rule under --evidence: capped per rule,
// kept in the order they were added, and rules listed in name order.
// Unit spec: the class has no collaborators, so nothing is mocked.

import { describe, expect, it } from "vitest";
import { RuleLocations } from "./retro-locations.js";

const at = (session: string, line: number) => ({
  session,
  line,
  excerpt: `${session}:${line}`,
});

describe("rule locations", () => {
  it("keeps the first 20 locations per rule, in the order they were added", () => {
    const locations = new RuleLocations();
    for (let line = 1; line <= 25; line++) {
      locations.add("bare-glob", at("a", line));
    }
    const kept = locations.sorted()["bare-glob"] ?? [];
    expect(kept).toHaveLength(20);
    expect(kept[0]).toEqual(at("a", 1));
    expect(kept[19]).toEqual(at("a", 20));
  });

  it("lists rules in name order, with each rule's own locations", () => {
    const locations = new RuleLocations();
    locations.add("role-worktree", at("a", 4));
    locations.add("bare-glob", at("a", 9));
    expect(Object.entries(locations.sorted())).toEqual([
      ["bare-glob", [at("a", 9)]],
      ["role-worktree", [at("a", 4)]],
    ]);
  });

  it("reports no entry for a rule that was never added", () => {
    expect(new RuleLocations().sorted()).toEqual({});
  });
});
