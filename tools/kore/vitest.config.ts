import { configDefaults, defineConfig } from "vitest/config";
import { budgetReporters } from "../harness/src/hook/test-budget-config.ts";
import { testWorkers } from "./.husky/test-workers.mjs";

export default defineConfig({
  test: {
    // One cap for every unit path; see .husky/test-workers.mjs.
    maxWorkers: testWorkers(),
    // Worker threads start faster than forked processes and cut the run's CPU by about a third (the unit-run budget, ADR 0098).
    pool: "threads",
    // The test-budget hook reads this report; see `test:budget` in package.json.
    reporters: budgetReporters(
      "test-results/unit.json",
      configDefaults.reporters,
    ),
    // A mock's calls and behaviour, and a spy's real method, reset before each test (ADR 0098).
    mockReset: true,
    restoreMocks: true,
    setupFiles: ["src/test-setup-support.ts"],
    include: ["src/**/*.spec.ts"],
    exclude: ["**/*.live.spec.ts", "dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.spec.ts",
        "src/**/*.live.spec.ts",
        "src/**/*-support.ts",
        "src/**/*.fixtures.ts",
        "src/**/*.live.ts",
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
