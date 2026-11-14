import { configDefaults, defineConfig } from "vitest/config";
import { budgetReporters } from "./src/hook/test-budget-config.ts";
import { testWorkers } from "../kore/.husky/test-workers.mjs";

const bundleFiles = [
  "tests/bundle.spec.ts",
  "tests/guard-bundle.spec.ts",
  "../../.claude/hooks/harness-launcher.test.mjs",
];

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
    // Build skills/bin/harness.mjs once per run: the bundle specs read it.
    globalSetup: ["tests/build-bundle-setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "src/**/*.spec.ts",
            "tests/**/*.spec.ts",
            // The hook, status line and eval-grading cases live beside their scripts.
            "../../.claude/hooks/*.test.mjs",
            "../../.claude/evals/*.test.mjs",
          ],
          exclude: bundleFiles,
          sequence: { groupOrder: 0 },
        },
      },
      {
        // These read the built bundle, so they never overlap.
        extends: true,
        test: {
          name: "bundle",
          include: bundleFiles,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
    // The hook cases spawn real processes and git; node:test never timed them.
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
