import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/**/*.spec.ts",
      "tests/**/*.spec.ts",
      // The hook, status line and eval-grading cases live beside their scripts.
      "../../.claude/hooks/*.test.mjs",
      "../../.claude/evals/*.test.mjs",
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
        statements: 95,
        branches: 84,
        functions: 94,
        lines: 95,
      },
    },
  },
});
