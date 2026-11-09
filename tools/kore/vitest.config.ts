import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
