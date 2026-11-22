import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
// Read-only: `docker stats`, `docker info`, `kubectl get pods`, and swap from
// `sysctl vm.swapusage` on macOS or `/proc/meminfo` on Linux; it changes no
// resource. Prints one run as JSON, verdict included; the person
// recording the Now baseline repeats it and takes the mean of the run medians
// (footprintBaseline). Run with KORE_RUN_LIVE=1 (`npm run test:live:footprint`).

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_LIVE !== "1"
      ? "set KORE_RUN_LIVE=1 to opt into a live platform"
      : false,
  timeout: 15 * 60 * 1000,
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
        kubeContext: repository.environment.kubeContext,
      },
      {
        sleep: (seconds) =>
          new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
        loadAverage: () => loadavg()[0] ?? Number.POSITIVE_INFINITY,
        now: () => performance.now(),
        epochMilliseconds: () => Date.now(),
        platform: process.platform,
        readFile: (path) => readFile(path, "utf8"),
      },
    );
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
    console.log(JSON.stringify(result, null, 2));
  },
);
