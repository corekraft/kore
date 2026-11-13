import assert from "node:assert/strict";
import test from "node:test";
import { loadRepository } from "../config/index.js";
import { clusterDestroy } from "../cluster/index.js";
import { ProcessRunner, integrationEnvironment } from "../runtime/index.js";
import { assertDatabasePersistence } from "./platform.database.integration.spec.js";
import { assertReferenceSmoke } from "./platform.reference-smoke.integration.spec.js";

const environment = integrationEnvironment();

test(
  "README local quick start converges and cleans up",
  {
    concurrency: false,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live platform"
        : false,
    timeout: 45 * 60 * 1000,
  },
  async () => {
    const repository = await loadRepository(integrationEnvironment());
    const runner = new ProcessRunner();
    try {
      await runner.run("mise", ["install"], {
        capture: false,
        cwd: repository.root,
      });
      await runner.run(
        "mise",
        ["exec", "--", "npm", "--prefix", "tools/kore", "install"],
        { capture: false, cwd: repository.root },
      );
      for (const args of [["test"], ["run", "test:opa"]]) {
        await runner.run(
          "mise",
          ["exec", "--", "npm", "--prefix", "tools/kore", ...args],
          { capture: false, cwd: repository.root },
        );
      }
      for (const args of [
        ["doctor", "--environment", environment],
        ["validate", "--environment", environment],
        ["local", "up", "--environment", environment],
        ["app", "status", "reference", "--environment", environment],
      ]) {
        const result = await runner.run(
          "mise",
          [
            "exec",
            "--",
            "npm",
            "--prefix",
            "tools/kore",
            "run",
            "kore",
            "--",
            ...args,
          ],
          { capture: false, cwd: repository.root },
        );
        assert.equal(
          result.code,
          0,
          `README command failed: kore ${args.join(" ")}`,
        );
      }
      await assertReferenceSmoke(repository, runner);
      await assertDatabasePersistence(repository, runner);
    } finally {
      await clusterDestroy(repository, runner, {
        yes: true,
        purgeData: true,
      });
    }
  },
);
