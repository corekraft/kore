import assert from "node:assert/strict";
import { loadavg } from "node:os";
import test from "node:test";
import { loadRepository } from "../config/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";
import { HostConditions } from "./ingress-host.js";
import { mkcertRoot } from "./gateway-cluster.live.js";
import { ingressMeasurementDefaults } from "./ingress-measurement.js";
import { RatedMeasurement } from "./ingress-rated-measurement.js";
import { parseTargetRate, targetRateVariable } from "./ingress-pacing.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
// Live: needs a running k3d cluster. Read-only against the cluster (metrics
// API reads) plus the fixed request load to the Gateway; it changes no
// resource. Prints the measurement as JSON for the plan's Results section.
// Run with KORE_RUN_LIVE=1 (`npm run test:live:ingress-measure`).
// Set KORE_INGRESS_TARGET_RPS=<requests per second> for a paced, matched-load
// run: the result then carries `rate` (target, achieved, `matched` or
// `rate_mismatch`) and the test fails on a mismatch, because a run whose
// achieved rate is not within 10 percent of the target is not comparable.
// The result's `host` records the 1, 5 and 15 minute load, swap used, free
// Docker VM memory and the agent pane count (from `herdr agent list`; a
// missing herdr is named in `missing`, not counted as zero) before and after.
// Unset keeps the closed-loop load. Use the same target for both gateways.

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_LIVE !== "1"
      ? "set KORE_RUN_LIVE=1 to opt into a live platform"
      : false,
  timeout: 15 * 60 * 1000,
};

test(
  "measures the Gateway pods under the fixed load without changing cluster resources",
  live,
  async () => {
    const repository = await loadRepository(liveEnvironment());
    const { gateway, kubeContext } = repository.environment;
    const target = parseTargetRate(process.env[targetRateVariable]);
    const runner = new ProcessRunner();
    const deps = {
      sleep: (seconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)),
      loadAverage: () => loadavg()[0] ?? Number.POSITIVE_INFINITY,
      now: () => performance.now(),
    };
    const host = new HostConditions(runner, `${kubeContext}-server-0`, {
      loadAverages: () => {
        const [one = 0, five = 0, fifteen = 0] = loadavg();
        return [one, five, fifteen];
      },
    });
    const measurement = new RatedMeasurement(
      runner,
      runner,
      {
        ...ingressMeasurementDefaults,
        ...(target === undefined ? {} : { targetRequestsPerSecond: target }),
        kubeContext,
        gateway: { namespace: gateway.namespace, name: gateway.name },
        hostname: gateway.hostname,
        port: gateway.port,
        caRoot: await mkcertRoot(runner),
      },
      deps,
      host,
    );
    const result = await measurement.measure();
    assert.ok(result.pods.ingress.length > 0);
    assert.ok(result.pods.ztunnel.length > 0);
    for (const value of [
      result.summary.ingress.cpuMillicores.median,
      result.summary.ingress.memoryMiB.median,
      result.summary.ztunnel.cpuMillicores.median,
      result.summary.ztunnel.memoryMiB.median,
      result.load.requestsPerSecond,
    ]) {
      assert.ok(Number.isFinite(value) && value > 0);
    }
    assert.ok(result.latency !== undefined && result.latency.p95Ms > 0);
    assert.ok(result.host !== undefined);
    console.log(JSON.stringify(result, null, 2));
    if (result.rate !== undefined) {
      assert.equal(
        result.rate.status,
        "matched",
        `rate_mismatch: achieved ${result.rate.achievedRequestsPerSecond} req/s against a target of ${result.rate.targetRequestsPerSecond}; not usable as a matched comparison, rerun at a quieter host or a lower ${targetRateVariable}`,
      );
    }
  },
);
