import assert from "node:assert/strict";
import { loadavg } from "node:os";
import test from "node:test";
import { loadRepository } from "../config/index.js";
import { ProcessRunner, integrationEnvironment } from "../runtime/index.js";
import { mkcertRoot } from "./gateway-cluster-support.js";
import {
  IngressMeasurement,
  ingressMeasurementDefaults,
} from "./ingress-measurement.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
// Live: needs a running k3d cluster. Read-only against the cluster (metrics
// API reads) plus the fixed request load to the Gateway; it changes no
// resource. Prints the measurement as JSON for the plan's Results section.
// Run with KORE_RUN_INTEGRATION=1 (`npm run test:integration:ingress-measure`).

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live platform"
      : false,
  timeout: 15 * 60 * 1000,
};

test(
  "measures the Gateway pods under the fixed load without changing cluster resources",
  live,
  async () => {
    const repository = await loadRepository(integrationEnvironment());
    const { gateway, kubeContext } = repository.environment;
    const runner = new ProcessRunner();
    const measurement = new IngressMeasurement(
      runner,
      runner,
      {
        ...ingressMeasurementDefaults,
        kubeContext,
        gateway: { namespace: gateway.namespace, name: gateway.name },
        hostname: gateway.hostname,
        port: gateway.port,
        caRoot: await mkcertRoot(runner),
      },
      {
        sleep: (seconds) =>
          new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
        loadAverage: () => loadavg()[0] ?? Number.POSITIVE_INFINITY,
        now: () => performance.now(),
      },
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
    console.log(JSON.stringify(result, null, 2));
  },
);
