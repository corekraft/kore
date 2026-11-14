// The unit-run hooks by name: the test budget and the one-spec check, which the
// hook registry spreads in. Both commands are mocked; the name map is real.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it, vi } from "vitest";
import type { Command } from "../runtime/index.js";

const budget: Command = { summary: "budget", options: {}, run: vi.fn() };
const specs: Command = { summary: "specs", options: {}, run: vi.fn() };

vi.mock("./test-budget.js", () => ({ testBudgetHook: budget }));
vi.mock("./unit-specs.js", () => ({ unitSpecsHook: specs }));

const { testHooks } = await import("./test-hooks.js");

describe("the unit-run hooks", () => {
  it("runs harness hook test-budget as the budget and unit-specs as the one-spec check, and no other hook", () => {
    expect(Object.keys(testHooks)).toEqual(["test-budget", "unit-specs"]);
    expect(testHooks["test-budget"]).toBe(budget);
    expect(testHooks["unit-specs"]).toBe(specs);
  });
});
