// What the vitest configs wire in for the test budget: vitest's own reporters plus the BudgetReporter,
// with the report written to and removed from disk. The reporter and node:fs are mocked.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BudgetReporter } from "./test-budget-reporter.js";
import { budgetReporters } from "./test-budget-config.js";

vi.mock("node:fs");
vi.mock("./test-budget-reporter.js");

describe("budgetReporters", () => {
  it("keeps vitest's own reporters, so CI annotations and agent output survive, and adds the budget reporter after the ones it is given", () => {
    const reporters = budgetReporters("test-results/unit.json", [
      "default",
      "github-actions",
    ]);
    expect(reporters).toHaveLength(3);
    expect(reporters.slice(0, 2)).toEqual(["default", "github-actions"]);
    expect(reporters[2]).toBeInstanceOf(BudgetReporter);
  });

  it("writes the report into its directory, creating the directory", () => {
    budgetReporters("test-results/unit.json", []);
    const { write } = vi.mocked(BudgetReporter).mock.calls[0]?.[0] ?? {};
    write?.("test-results/unit.json", "{}");
    expect(mkdirSync).toHaveBeenCalledWith("test-results", { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith("test-results/unit.json", "{}");
  });

  it("removes the old report without failing when there is none", () => {
    budgetReporters("test-results/unit.json", []);
    const { remove } = vi.mocked(BudgetReporter).mock.calls[0]?.[0] ?? {};
    remove?.("test-results/unit.json");
    expect(rmSync).toHaveBeenCalledWith("test-results/unit.json", {
      force: true,
    });
  });
});
