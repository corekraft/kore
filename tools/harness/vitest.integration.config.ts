import { defineConfig } from "vitest/config";

// Integration specs: real domains together, in temporary directories. Neither the unit run
// (vitest.config.ts) nor the commit hook's related tests include this folder. Run with
// `npm --prefix tools/harness run test:integration`.
export default defineConfig({
  test: {
    name: "integration",
    include: ["integration/**/*.ts"],
    // The guard-bundle spec reads the built bundle, so build it first (ADR 0092).
    globalSetup: ["tests/build-bundle-setup.ts"],
  },
});
