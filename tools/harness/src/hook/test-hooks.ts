// The hooks the unit run runs, by name: the test budget and the one-spec check.
// The hook registry spreads them in, so it keeps one import for both.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import type { Command } from "../runtime/index.js";
import { testBudgetHook } from "./test-budget.js";
import { unitSpecsHook } from "./unit-specs.js";

export const testHooks: Record<string, Command> = {
  "test-budget": testBudgetHook,
  "unit-specs": unitSpecsHook,
};
