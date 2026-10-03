import test from "node:test";
import { findRoot, loadRepository } from "./config.js";
import {
  clusterDestroy,
  clusterStatus,
  clusterStop,
  clusterUp,
} from "./cluster.js";
import { ProcessRunner } from "./runner.js";

test(
  "Minikube create/inspect/stop/resume integration",
  {
    concurrency: false,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live cluster"
        : false,
  },
  async () => {
    const repository = await loadRepository("local", await findRoot());
    const runner = new ProcessRunner();
    try {
      await clusterUp(repository, runner);
      await clusterStatus(repository, runner);
      await clusterStop(repository, runner);
      await clusterUp(repository, runner);
      await clusterStatus(repository, runner);
    } finally {
      await clusterDestroy(repository, runner, { yes: true, purgeData: true });
    }
  },
);
