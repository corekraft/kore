import { defineConfig } from "vitest/config";

const bundleFiles = [
  "tests/bundle.spec.ts",
  "../../.claude/hooks/harness-bundle.test.mjs",
];

export default defineConfig({
  test: {
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
        // These rewrite and read the committed bundle, so they never overlap.
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
        statements: 95,
        branches: 84,
        functions: 94,
        lines: 95,
      },
    },
  },
});
