import { defineConfig } from "vitest/config";
import { writeBudgetReport } from "./.husky/budget-report.mjs";
import { BudgetReporter } from "../harness/src/hook/test-budget-reporter.ts";
import { testWorkers } from "./.husky/test-workers.mjs";

export default defineConfig({
  test: {
    // One cap for every unit path; see .husky/test-workers.mjs.
    maxWorkers: testWorkers(),
    // The test-budget hook reads this report; see `test:budget` in package.json.
    reporters: [
      "default",
      new BudgetReporter({
        outputFile: "test-results/unit.json",
        write: writeBudgetReport,
        now: Date.now,
      }),
    ],
    setupFiles: ["src/test-setup-support.ts"],
    include: ["src/**/*.spec.ts"],
    exclude: ["**/*.integration.spec.ts", "dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.spec.ts",
        "src/**/*.integration.spec.ts",
        "src/**/*-support.ts",
        "src/**/*.fixtures.ts",
        "dist/**",
      ],
      reporter: ["text", "html"],
      thresholds: {
        statements: 95,
        branches: 84,
        functions: 94,
        lines: 95,
      },
    },
  },
});
