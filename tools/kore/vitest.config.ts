import { defineConfig } from "vitest/config";
import { testWorkers } from "./.husky/test-workers.mjs";

export default defineConfig({
  test: {
    // One cap for every unit path; see .husky/test-workers.mjs.
    maxWorkers: testWorkers(),
    setupFiles: ["src/test-setup-support.ts"],
    // The integration tier runs real units together, never a cluster. Only
    // `test:integration` runs it; the unit project and every default run skip it.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.spec.ts"],
          exclude: ["**/*.live.spec.ts", "**/*.integration.spec.ts", "dist/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.integration.spec.ts"],
          exclude: ["dist/**"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.spec.ts",
        "src/**/*.live.spec.ts",
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
