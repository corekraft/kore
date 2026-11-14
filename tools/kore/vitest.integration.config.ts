import { defineConfig } from "vitest/config";

// Integration specs: real units together, with local processes and temporary
// files but no cluster or network. Neither the unit run (vitest.config.ts) nor
// the commit hook's related tests include this folder. Run with
// `npm --prefix tools/kore run test:integration`.
export default defineConfig({
  test: {
    name: "integration",
    include: ["integration/**/*.ts"],
    // Fakes and fixtures a spec imports are not specs themselves (ADR 0098).
    exclude: ["**/node_modules/**", "**/*-support.ts"],
    // Host locks and ownership records go to a temporary host root, never the real home.
    setupFiles: ["integration-setup.ts"],
  },
});
