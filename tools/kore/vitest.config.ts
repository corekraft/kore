import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    exclude: ["**/*.integration.spec.ts", "dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.spec.ts",
        "src/**/*.integration.spec.ts",
        "dist/**",
      ],
      reporter: ["text", "html"],
      thresholds: {
        statements: 84,
        branches: 70,
        functions: 83,
        lines: 85,
      },
    },
  },
});
