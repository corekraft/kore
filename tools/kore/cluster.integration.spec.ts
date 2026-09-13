import test from "node:test";
import { findRoot, loadRepository } from "./config.js";
import { clusterStatus, clusterStop, clusterUp } from "./cluster.js";
import { ProcessRunner } from "./runner.js";

test("Minikube create/inspect/stop/resume integration", {skip: process.env.KORE_RUN_INTEGRATION !== "1" ? "set KORE_RUN_INTEGRATION=1 to opt into a live cluster" : false}, async () => {
  const repository = await loadRepository("local", await findRoot()); const runner = new ProcessRunner();
  await clusterUp(repository,runner); await clusterStatus(repository,runner); await clusterStop(repository,runner); await clusterUp(repository,runner); await clusterStatus(repository,runner);
});
