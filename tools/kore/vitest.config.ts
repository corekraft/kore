import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.spec.ts"],
    exclude: ["**/*.integration.spec.ts", "dist/**"],
  },
});
