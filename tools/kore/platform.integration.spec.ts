import assert from "node:assert/strict";
import test from "node:test";
import { loadRepository } from "./config.js";
import { clusterDestroy } from "./cluster.js";
import { ProcessRunner } from "./runner.js";
import { stopLocalTunnel } from "./tunnel.js";

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
    const repository = await loadRepository("local");
    const runner = new ProcessRunner();
    try {
      await runner.run("mise", ["install"], { capture: false, cwd: repository.root });
      await runner.run("mise", ["exec", "--", "npm", "--prefix", "tools/kore", "install"], { capture: false, cwd: repository.root });
      for (const args of [
        ["test"],
        ["run", "test:opa"],
      ]) {
        await runner.run("mise", ["exec", "--", "npm", "--prefix", "tools/kore", ...args], { capture: false, cwd: repository.root });
      }
      for (const args of [
        ["doctor", "--environment", "local"],
        ["validate", "--environment", "local"],
        ["cluster", "up", "--environment", "local"],
        ["tunnel", "start", "--environment", "local"],
        ["platform", "bootstrap", "--environment", "local"],
        ["trust", "install", "--environment", "local"],
        ["platform", "up", "--environment", "local"],
        ["app", "up", "reference", "--environment", "local"],
        ["app", "status", "reference", "--environment", "local"],
      ]) {
        const result = await runner.run("mise", ["exec", "--", "npm", "--prefix", "tools/kore", "run", "kore", "--", ...args], { capture: false, cwd: repository.root });
        assert.equal(result.code, 0, `README command failed: kore ${args.join(" ")}`);
      }
    } finally {
      try {
        await stopLocalTunnel(repository, runner);
      } finally {
        await clusterDestroy(repository, runner, { yes: true, purgeData: true });
      }
    }
  },
);
