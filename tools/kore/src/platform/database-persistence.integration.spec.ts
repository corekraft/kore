import test from "node:test";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository } from "../config/index.js";
import { findRoot } from "../config/config.js";
import { ProcessRunner, integrationEnvironment } from "../runtime/index.js";
import { assertDatabasePersistence } from "./platform.database.integration.spec.js";

// Docs: docs/decisions/0093-the-nightly-live-proof-runs-on-a-hosted-linux-runner-under-bounded-timeouts.md
// Live and opt-in (`npm run test:integration:database`): needs a running local
// profile with the `reference` application up. It writes a row, deletes the
// reference database's primary pod, and waits for the replacement (up to 5
// minutes, twice) to prove the row survived. It is the only suite that proves
// database persistence, so the nightly runs it.

test(
  "the reference database keeps its data across the loss of its primary pod",
  {
    concurrency: false,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
        : false,
    timeout: 20 * 60 * 1000,
  },
  async () => {
    const repository = await loadRepository(
      integrationEnvironment(),
      await findRoot(),
    );
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);
    await assertDatabasePersistence(repository, runner);
  },
);
