import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadavg } from "node:os";
import test from "node:test";
import {
  gatewayEntryPort,
  loadRepository,
  platformPlan,
  internalGateway,
} from "../config/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";
import { mkcertRoot } from "./gateway-cluster.live.js";
import { goldenPathReach } from "./golden-path-reach.live.js";
import type { GoldenPathReach } from "./golden-path-reach.live.js";
import { waitForQuietHost } from "./golden-path-quiet-host.js";
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
// - the scale check, which writes nothing: the BFF's HorizontalPodAutoscaler
//   scales it out under load and back to its minimum. It starts only once the
//   host load has fallen under the check's guard, and its scale-in waits out the
//   autoscaler's scale-down window.
// The probes reach the service's own Gateway at its published address, or, when
// the service has no Gateway of its own, the shared Gateway on loopback. Any other
// case fails before any load is sent, naming the cause (golden-path-reach.live.ts).
// Only baselines are recorded; there is no target. KORE_GOLDEN_PATH_SERVICE
// names the delivered Service (default golden-path-example), and
// KORE_SCALE_PEAK_REPLICAS is N (default 4), which must be above the autoscaler's
// minimum and at most its maximum.

// The probes take the address only when the Service publishes one.
function addressOf(reach: GoldenPathReach): { address?: string } {
  return reach.address === undefined ? {} : { address: reach.address };
}

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
  const { kubeContext, name } = repository.environment;
  const service = process.env.KORE_GOLDEN_PATH_SERVICE ?? "golden-path-example";
  const runner = new ProcessRunner();
  // Fails before any load when the Service publishes no address to reach.
  const reach = await goldenPathReach(runner, {
    kubeContext,
    namespace: `${service}--${name}`,
    service,
    sharedGateway: {
      ...internalGateway(repository.environment),
      port: gatewayEntryPort,
    },
  });
  return {
    runner,
    kubeContext,
    service,
    namespace: `${service}--${name}`,
    hostname: `${service}.platform.${platformPlan(repository.environment).domain}`,
    reach,
    port: reach.port,
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
      platform: process.platform,
      readFile: (path) => readFile(path, "utf8"),
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
        gateway: c.reach.gateway,
        hostname: c.hostname,
        port: c.reach.port,
        ...addressOf(c.reach),
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
    // The p95 test before this one leaves the host busy; wait for it to quiet.
    await waitForQuietHost(c.deps, scaleCheckDefaults);
    const result = await new GoldenPathScaleCheck(
      c.runner,
      c.runner,
      {
        ...scaleCheckDefaults,
        kubeContext: c.kubeContext,
        namespace: c.namespace,
        deployment: `${c.service}-bff`,
        peakReplicas: count("KORE_SCALE_PEAK_REPLICAS") ?? 4,
        hostname: c.hostname,
        port: c.reach.port,
        ...addressOf(c.reach),
        caRoot: c.caRoot,
      },
      c.deps,
      c.host,
    ).run();
    assert.equal(result.load.failedRequests, 0);
    assert.ok(result.replicas.peak > result.replicas.start);
    assert.equal(result.replicas.end, result.replicas.start);
    assert.ok(result.host !== undefined);
    console.log(JSON.stringify(result, null, 2));
  },
);
