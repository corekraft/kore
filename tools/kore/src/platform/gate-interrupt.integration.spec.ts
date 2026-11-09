import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository } from "../config/index.js";
import { findRoot } from "../config/config.js";
import { ProcessRunner } from "../runtime/index.js";
import {
  assertAdmissionGateOpen,
  readAdmissionGate,
} from "./admission-gate.js";
import { runKore, startKore, until } from "./gate-degradation-support.js";

// Docs: docs/decisions/0067-platform-readiness-manifest-and-evidence.md
// Live and opt-in (`npm run test:integration:gate-interrupt`,
// KORE_RUN_INTEGRATION=1): needs a converged local profile. It proves that an
// interrupted bootstrap leaves the platform gate closed:
//   1. `kore platform up` is started as a real process and SIGTERMed once its
//      first step has closed the gate (the gate was open, so the transition to
//      closed proves bootstrap is mid-run);
//   2. the gate stays closed, `kore platform status` exits non-zero and kore
//      refuses applications, however long we wait;
//   3. only a full rerun of `kore platform up` reopens it, after which
//      status exits zero.
// A final full rerun in `finally` restores the profile if the proof stopped
// early. Every kore mutation names --environment local (context kore-local).

const environment = ["--environment", "local"];
const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
      : false,
  timeout: 45 * 60 * 1000,
};

test(
  "an interrupted platform up leaves the gate closed until a full rerun reopens it",
  live,
  async () => {
    const repository = await loadRepository("local", await findRoot());
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);
    await assertAdmissionGateOpen(repository, runner).catch((error) => {
      throw new Error(
        `run kore platform up first: the proof starts from an open gate (${String(error)})`,
        { cause: error },
      );
    });
    const state = async () =>
      (await readAdmissionGate(repository, runner))?.state;

    const up = startKore(["platform", "up", ...environment, "--yes"]);
    try {
      await until("bootstrap to close the gate", async () =>
        (await state()) === "closed" ? true : undefined,
      );
      up.child.kill("SIGTERM");
      const interrupted = await up.done;
      assert.notEqual(interrupted.code, 0, "an interrupted run is not success");

      assert.equal(
        await state(),
        "closed",
        "the interrupted run left the gate closed",
      );
      const status = await runKore(["platform", "status", ...environment]);
      assert.notEqual(
        status.code,
        0,
        "status cannot report success after an interruption",
      );
      await assert.rejects(
        assertAdmissionGateOpen(repository, runner),
        /application admission gate is closed/,
      );
      // Time does not reopen it: only a successful run does.
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      assert.equal(await state(), "closed");

      const rerun = await runKore(["platform", "up", ...environment, "--yes"]);
      assert.equal(rerun.code, 0, `the rerun converges: ${rerun.stderr}`);
      assert.equal(await state(), "open");
      assert.equal(
        (await runKore(["platform", "status", ...environment])).code,
        0,
      );
    } finally {
      if (up.child.exitCode === null) {
        up.child.kill("SIGTERM");
        await up.done;
      }
      if ((await state()) !== "open") {
        await runKore(["platform", "up", ...environment, "--yes"]);
      }
    }
  },
);
