import { beforeEach, expect, it, vi } from "vitest";
import { guardBlocks } from "./outcomes.js";
import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./intervals.js";
import {
  KNOWN_GUARD_RULES,
  guardBlocksByRule,
} from "./guard-blocks-by-rule.js";

vi.mock("./outcomes.js");

const WINDOW: Span = [0, 1000];
const EVENTS = [] as LedgerEvent[];

beforeEach(() => {
  vi.mocked(guardBlocks).mockReturnValue([]);
});

it("seeds every known guard rule at zero, so an empty ledger still names each rule", () => {
  expect(guardBlocksByRule(EVENTS, WINDOW)).toEqual(
    Object.fromEntries(KNOWN_GUARD_RULES.map((rule) => [rule, 0])),
  );
});

it("names role-no-merge at zero from an empty ledger, the rule idea 0022 measures", () => {
  expect(guardBlocksByRule(EVENTS, WINDOW)["role-no-merge"]).toBe(0);
});

it("counts each rule's blocks in the window from the guard blocks, and keeps a rule the list does not name", () => {
  vi.mocked(guardBlocks).mockReturnValue([
    { rule: "role-no-merge", blocks: 3 },
    { rule: "a-rule-not-yet-listed", blocks: 1 },
  ]);
  const counts = guardBlocksByRule(EVENTS, WINDOW);
  expect(counts["role-no-merge"]).toBe(3);
  expect(counts["a-rule-not-yet-listed"]).toBe(1);
  expect(counts["role-worktree"]).toBe(0);
});

it("counts the blocks of the events and window it was given, not others", () => {
  guardBlocksByRule(EVENTS, WINDOW);
  expect(guardBlocks).toHaveBeenCalledWith(EVENTS, WINDOW);
});

it("lists the known rules first in their list order, then any rule the list does not name", () => {
  vi.mocked(guardBlocks).mockReturnValue([{ rule: "zzz-new", blocks: 2 }]);
  const keys = Object.keys(guardBlocksByRule(EVENTS, WINDOW));
  expect(keys).toEqual([...KNOWN_GUARD_RULES, "zzz-new"]);
});

it("names only hook-enforced guard rules: no deny rule and no judge checklist item", () => {
  expect(KNOWN_GUARD_RULES).not.toContain("deny-cluster-delete");
  expect(KNOWN_GUARD_RULES).not.toContain("judge-ci");
  expect(KNOWN_GUARD_RULES).not.toContain("main-ruleset-deletion");
});

it("lists each known guard rule once, sorted by name", () => {
  expect(new Set(KNOWN_GUARD_RULES).size).toBe(KNOWN_GUARD_RULES.length);
  expect([...KNOWN_GUARD_RULES]).toEqual([...KNOWN_GUARD_RULES].sort());
});
