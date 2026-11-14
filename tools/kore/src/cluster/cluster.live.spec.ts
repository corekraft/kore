import test from "node:test";
import { loadRepository } from "../config/index.js";
import { findRoot } from "../config/index.js";
import {
  clusterDestroy,
  clusterStatus,
  clusterStop,
  clusterUp,
} from "../cluster/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";

test(
  "k3d create/inspect/stop/resume live",
  {
    concurrency: false,
    skip:
      process.env.KORE_RUN_LIVE !== "1"
        ? "set KORE_RUN_LIVE=1 to opt into a live cluster"
        : false,
  },
  async () => {
    const repository = await loadRepository(
      liveEnvironment(),
      await findRoot(),
    );
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
