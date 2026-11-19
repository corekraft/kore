import assert from "node:assert/strict";
import { loadavg } from "node:os";
import test from "node:test";
import { loadRepository } from "../config/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";
import { mkcertRoot } from "./gateway-cluster.live.js";
import { goldenPathRouteSet } from "./golden-path-routes.js";
import {
  GoldenPathScaleCheck,
  scaleCheckDefaults,
} from "./golden-path-scale-check.js";
import { HostConditions } from "./ingress-host.js";
import { ingressMeasurementDefaults } from "./ingress-measurement.js";
import { RatedMeasurement } from "./ingress-rated-measurement.js";

// Docs: infra/plans/13-agentgateway-ingress.md#golden-path-route-set
// Live: needs a converged local k3d platform with `autoscaling-defaults` on and
// the golden-path example delivered through Argo CD. ONE RUN AT A TIME on an
// idle host: stop writer and challenger panes first. Run with KORE_RUN_LIVE=1
// (`npm run test:live:golden-path-load` in tools/kore).
//
// Two tests, each printing one JSON record with the host record beside it:
// - the golden-path p95, p50 and max at the service's own Gateway, read-only
//   against the cluster, separate from the reference routes' numbers;
// - the scale check, whose one cluster write is `kubectl scale` on the BFF
//   Deployment, put back to its starting count however the run ends.
// Only baselines are recorded; there is no target. KORE_GOLDEN_PATH_SERVICE
// names the delivered Service (default golden-path-example),
// KORE_SCALE_PEAK_REPLICAS is N (default 4) and KORE_SCALE_START_REPLICAS sets
// the starting count (default: the Deployment's own).

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_LIVE !== "1"
      ? "set KORE_RUN_LIVE=1 to opt into a live platform"
      : false,
  timeout: 15 * 60 * 1000,
};

function count(variable: string): number | undefined {
  const raw = process.env[variable];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const value = Number(raw);
  assert.ok(
    Number.isInteger(value) && value > 0,
    `${variable} must be a positive whole number, got '${raw}'`,
  );
  return value;
}

async function context() {
  const repository = await loadRepository(liveEnvironment());
  const { gateway, kubeContext, name } = repository.environment;
  const service = process.env.KORE_GOLDEN_PATH_SERVICE ?? "golden-path-example";
  const runner = new ProcessRunner();
  return {
    runner,
    kubeContext,
    service,
    namespace: `${service}--${name}`,
    hostname: `${service}.platform.${gateway.hostname}`,
    port: gateway.port,
    caRoot: await mkcertRoot(runner),
    deps: {
      sleep: (seconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)),
      loadAverage: () => loadavg()[0] ?? Number.POSITIVE_INFINITY,
      now: () => performance.now(),
    },
    host: new HostConditions(runner, `${kubeContext}-server-0`, {
      loadAverages: () => {
        const [one = 0, five = 0, fifteen = 0] = loadavg();
        return [one, five, fifteen];
      },
    }),
  };
}

test(
  "records the golden-path routes' p95, p50 and max at the service Gateway without changing cluster resources",
  live,
  async () => {
    const c = await context();
    const result = await new RatedMeasurement(
      c.runner,
      c.runner,
      {
        ...ingressMeasurementDefaults,
        kubeContext: c.kubeContext,
        gateway: { namespace: c.namespace, name: c.service },
        hostname: c.hostname,
        port: c.port,
        caRoot: c.caRoot,
        routeSet: goldenPathRouteSet,
      },
      c.deps,
      c.host,
    ).measure();
    assert.equal(result.method.routeSet, goldenPathRouteSet.name);
    assert.ok(result.latency !== undefined && result.latency.p95Ms > 0);
    assert.ok(result.host !== undefined);
    console.log(JSON.stringify(result, null, 2));
  },
);

test(
  "scales the golden-path BFF out and back under load with no failed request",
  live,
  async () => {
    const c = await context();
    const startReplicas = count("KORE_SCALE_START_REPLICAS");
    const result = await new GoldenPathScaleCheck(
      c.runner,
      c.runner,
      {
        ...scaleCheckDefaults,
        kubeContext: c.kubeContext,
        namespace: c.namespace,
        deployment: `${c.service}-bff`,
        ...(startReplicas === undefined ? {} : { startReplicas }),
        peakReplicas: count("KORE_SCALE_PEAK_REPLICAS") ?? 4,
        hostname: c.hostname,
        port: c.port,
        caRoot: c.caRoot,
      },
      c.deps,
      c.host,
    ).run();
    assert.equal(result.load.failedRequests, 0);
    assert.equal(result.replicas.peak, result.replicas.requestedPeak);
    assert.equal(result.replicas.end, result.replicas.start);
    assert.ok(result.host !== undefined);
    console.log(JSON.stringify(result, null, 2));
  },
);
