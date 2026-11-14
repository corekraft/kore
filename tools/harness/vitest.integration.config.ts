import { configDefaults, defineConfig } from "vitest/config";

// Integration specs: real domains together, in temporary directories, with real processes
// and the built bundle. The unit run (vitest.config.ts) and the commit hook's related tests
// never include them. Run with `npm --prefix tools/harness run test:integration`.
// The hook, status line and eval tests live beside their scripts in .claude/, so they run
// here by path; the merge check runs this tier only for a change to .claude/hooks (ADR 0098).
export default defineConfig({
  test: {
    name: "integration",
    include: [
      "integration/**/*.ts",
      "../../.claude/hooks/*.test.mjs",
      "../../.claude/evals/*.test.mjs",
    ],
    // Helpers beside the specs (`<name>-support.ts`) hold fakes and fixtures, not suites.
    exclude: [...configDefaults.exclude, "integration/**/*-support.ts"],
    // The guard-bundle spec reads the built bundle, so build it first (ADR 0092).
    globalSetup: ["tests/build-bundle-setup.ts"],
    // The guard startup timing must not share the host with another file, and the
    // hook cases spawn real processes and git.
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
