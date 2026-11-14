import { defineConfig } from "vitest/config";
import { testWorkers } from "../kore/.husky/test-workers.mjs";

const bundleFiles = [
  "tests/bundle.spec.ts",
  "tests/guard-bundle.spec.ts",
  "../../.claude/hooks/harness-launcher.test.mjs",
];

// The integration tier: real units run together, with local processes and
// temporary files but no cluster or network. A file joins it by its name
// (`*.integration.spec.ts`, `*.integration.test.mjs`) in one of these folders,
// and the unit project excludes it. Only `test:integration` runs it.
const integrationFiles = [
  "src/**/*.integration.spec.ts",
  "tests/**/*.integration.spec.ts",
  "../../.claude/hooks/*.integration.test.mjs",
  "../../.claude/evals/*.integration.test.mjs",
];

export default defineConfig({
  test: {
    // One cap for every unit path; see .husky/test-workers.mjs.
    maxWorkers: testWorkers(),
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
          exclude: [...bundleFiles, ...integrationFiles],
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
      {
        // Run only by `test:integration`: never by the default run, the unit
        // run, the hook run or the commit hook.
        extends: true,
        test: {
          name: "integration",
          include: integrationFiles,
          sequence: { groupOrder: 2 },
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
