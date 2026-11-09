import test from "node:test";
import { findRoot } from "../config/config.js";
import { loadRepository } from "../config/index.js";
import { ProcessRunner } from "../runtime/index.js";
import { proveDestroyRefused } from "./destroy-guard-support.js";

// Docs: infra/plans/2-implementation.md#step-10-storage-and-postgresql-platform-api
// Live and opt-in (`npm run test:integration:destroy-guard`): proves on the
// running local profile that `kore cluster destroy` without --purge-data
// refuses because retained data exists, and changes nothing.
//
// It passes no flags at all, not even --yes: without --yes the command cannot
// destroy the developer profile whatever it finds. The --yes variant, the
// strongest request that must still be refused, runs only against the
// throwaway profile in the clean-machine spec.

test(
  "cluster destroy without --purge-data refuses while retained data exists and changes nothing",
  {
    concurrency: false,
    timeout: 10 * 60 * 1000,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
        : false,
  },
  async () => {
    await proveDestroyRefused({
      repository: await loadRepository("local", await findRoot()),
      runner: new ProcessRunner(),
      flagSets: [[]],
    });
  },
);
