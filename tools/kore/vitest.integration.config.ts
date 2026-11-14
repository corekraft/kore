import { defineConfig } from "vitest/config";

// Integration specs: real units together, with local processes and temporary
// files but no cluster or network. Neither the unit run (vitest.config.ts) nor
// the commit hook's related tests include this folder. Run with
// `npm --prefix tools/kore run test:integration`.
export default defineConfig({
  test: {
    name: "integration",
    include: ["integration/**/*.ts"],
  },
});
