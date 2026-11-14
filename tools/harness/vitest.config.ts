import { configDefaults, defineConfig } from "vitest/config";
import { budgetReporters } from "./src/hook/test-budget-config.ts";
import { testWorkers } from "../kore/.husky/test-workers.mjs";

export default defineConfig({
  test: {
    // One cap for every unit path; see .husky/test-workers.mjs.
    maxWorkers: testWorkers(),
    // A mock's calls and behaviour, and a spy's real method, reset before each test (ADR 0098).
    mockReset: true,
    restoreMocks: true,
    // The test-budget hook reads this report; see `test:budget` in package.json.
    reporters: budgetReporters(
      "test-results/unit.json",
      configDefaults.reporters,
    ),
    // Unit specs start no process and read no built bundle. The hook, status line,
    // eval and bundle specs run in the integration tier (vitest.integration.config.ts).
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.spec.ts", "tests/**/*.spec.ts"],
          sequence: { groupOrder: 0 },
        },
      },
    ],
    // A backstop for a slow host; a unit test takes under 100 ms (ADR 0098).
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.spec.ts",
        "src/**/*-support.ts",
        // The entry point only wires real adapters; the bundle test runs it.
        "src/main.ts",
      ],
      reporter: ["text", "html"],
      thresholds: {
        statements: 97,
        branches: 90,
        functions: 98,
        lines: 97,
      },
    },
  },
});
