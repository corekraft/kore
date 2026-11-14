import assert from "node:assert/strict";
import { loadavg } from "node:os";
import test from "node:test";
import { loadRepository } from "../config/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";
import {
  FootprintMeasurement,
  footprintMeasurementDefaults,
} from "./footprint-measurement.js";

// Docs: infra/plans/2-implementation.md#step-7-bootstrap-registry-image-trust-controllers-and-crd-ownership
// Live: needs a converged local k3d platform with nothing else driving load.
// Read-only: `docker stats`, `docker info` and `sysctl`; it changes no
// resource. Prints one run as JSON; the person recording the Now baseline
// repeats it and takes the mean of the run medians (footprintBaseline).
// KORE_FOOTPRINT_RUNS (default 1, 2 to 5) repeats the measurement in this one
// process, each run printed with its load average beside it.
// Run with KORE_RUN_LIVE=1 (`npm run test:live:footprint`).

const runs = Number(process.env.KORE_FOOTPRINT_RUNS ?? "1");
if (!Number.isInteger(runs) || runs < 1 || runs > 5) {
  throw new Error(
    `KORE_FOOTPRINT_RUNS must be a whole number from 1 to 5, got "${process.env.KORE_FOOTPRINT_RUNS}"; unset it for a single run`,
  );
}

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_LIVE !== "1"
      ? "set KORE_RUN_LIVE=1 to opt into a live platform"
      : false,
  timeout: runs * 15 * 60 * 1000,
};

test(
  "measures the settled platform's footprint without changing the cluster",
  live,
  async () => {
    const repository = await loadRepository(liveEnvironment());
    const measurement = new FootprintMeasurement(
      new ProcessRunner(),
      {
        ...footprintMeasurementDefaults,
        serverContainer: `${repository.environment.kubeContext}-server-0`,
      },
      {
        sleep: (seconds) =>
          new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
        loadAverage: () => loadavg()[0] ?? Number.POSITIVE_INFINITY,
        now: () => performance.now(),
      },
    );
    for (let run = 1; run <= runs; run++) {
      const result = await measurement.measure();
      assert.equal(
        result.samples.length,
        footprintMeasurementDefaults.sampleCount,
      );
      for (const value of [
        result.vmMemoryMiB,
        result.summary.cpuMillicores.median,
        result.summary.memoryMiB.median,
        result.summary.memoryMiB.max,
      ]) {
        assert.ok(Number.isFinite(value) && value > 0);
      }
      console.log(
        `run ${run} of ${runs}: load average start ${result.loadAverage.start}, max ${result.loadAverage.max}`,
      );
      console.log(JSON.stringify(result, null, 2));
    }
  },
);
