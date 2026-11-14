// What the vitest configs wire in for the test budget: vitest's own reporters
// stay (CI annotations, the agent reporter), and the BudgetReporter is added.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BudgetReporter } from "./test-budget-reporter.js";

/** `defaults` is the config's own `configDefaults.reporters`, passed in so this file needs no vitest at load. */
export function budgetReporters(
  outputFile: string,
  defaults: readonly string[],
) {
  return [
    ...defaults,
    new BudgetReporter({
      outputFile,
      write: (path, text) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      },
      remove: (path) => rmSync(path, { force: true }),
      now: Date.now,
    }),
  ];
}
