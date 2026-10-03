import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.spec.ts"],
    exclude: ["**/*.integration.spec.ts", "dist/**"],
    coverage: {
      provider: "v8",
      include: ["*.ts"],
      exclude: [
        "*.spec.ts",
        "*.integration.spec.ts",
        "vitest.config.ts",
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
