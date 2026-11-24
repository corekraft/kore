import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadavg } from "node:os";
import test from "node:test";
import {
  gatewayEntryPort,
  internalGateway,
  loadRepository,
  platformPlan,
} from "../config/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";
import { mkcertRoot } from "./gateway-cluster.live.js";
import { goldenPathReach } from "./golden-path-reach.live.js";
import {
  drillRecordOf,
  rolloutDrill,
  type RolloutRecord,
} from "./golden-path-rollout-support.js";
import {
  probeUntil,
  reason,
  rollAll,
  targetsOf,
  type Probe,
} from "./golden-path-rollout-cluster.live.js";
import { HostConditions } from "./ingress-host.js";
import { loadArgs, type LoadTarget } from "./route-load.js";

// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md
// Docs: infra/plans/13-agentgateway-ingress.md#golden-path-route-set
// Live: the golden-path example delivered through Argo CD, the shared Gateway's
// proxy running. The coordinator runs it on kore-vps on an idle host, ONE RUN AT A
// TIME. Run with KORE_RUN_LIVE=1 (`npm run test:live:golden-path-rollout` in
// tools/kore). The nightly excludes it (nightly.sh).
//
// The promise, measured (owner decision 7 on #1480): while every Deployment of a
// golden-path service and the shared Gateway's proxy roll, a probe through the
// shared Gateway sees zero failed requests with no retries, and no Deployment's
// ready replicas drop below its count before its own rollout. The rules are in
// golden-path-rollout-support.ts, the cluster steps in golden-path-rollout-cluster.live.ts. Rollouts
// are `kubectl rollout restart`; Argo CD's selfHeal may revert that annotation as
// drift, and the record shows every rollout seen. Refused before any restart: a busy
// host, a service with its own Gateway, a missing Deployment or proxy, or a
// Deployment that is not settled.

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_LIVE !== "1"
      ? "set KORE_RUN_LIVE=1 to opt into a live platform"
      : false,
  timeout: 45 * 60 * 1000,
};

async function context() {
  const repository = await loadRepository(liveEnvironment());
  const environment = repository.environment;
  const { kubeContext, name } = environment;
  const service = process.env.KORE_GOLDEN_PATH_SERVICE ?? "golden-path-example";
  const namespace = `${service}--${name}`;
  const runner = new ProcessRunner();
  const gateway = internalGateway(environment);
  // Fails before any load when the service publishes no address to reach.
  const reach = await goldenPathReach(runner, {
    kubeContext,
    namespace,
    service,
    sharedGateway: { ...gateway, port: gatewayEntryPort },
  });
  if (reach.via !== "shared") {
    throw new Error(
      `the golden-path Service ${namespace}/${service} has its own Gateway; the rollout drill proves the shared Gateway, so it cannot run against this Service`,
    );
  }
  const target: LoadTarget = {
    hostname: `${service}.platform.${platformPlan(environment).domain}`,
    port: reach.port,
    caRoot: await mkcertRoot(runner),
    requestsPerRoute: rolloutDrill.requestsPerRoute,
    concurrency: rolloutDrill.concurrency,
    ...(reach.address === undefined ? {} : { address: reach.address }),
  };
  // curl retries nothing unless asked; a retry flag would hide the failure this proves absent.
  assert.ok(
    !loadArgs(target, "/").some((arg) => arg.startsWith("--retry")),
    "the probe's curl arguments must not retry a request",
  );
  return {
    runner,
    kubeContext,
    namespace,
    gateway,
    target,
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
  "rolls every Deployment of a golden-path service and the shared proxy under load with zero failed requests and no ready replica below its minimum",
  live,
  async () => {
    const c = await context();
    const loadAverage = loadavg()[0] ?? Number.POSITIVE_INFINITY;
    if (loadAverage >= rolloutDrill.maxLoadAverage) {
      throw new Error(
        `host 1-minute load average ${loadAverage} is not below ${rolloutDrill.maxLoadAverage}; wait for the host to quiet down and rerun`,
      );
    }
    const before = await c.host.read();
    // Refuses here, before any restart, when a target is missing or not settled.
    const targets = await targetsOf(c);

    const probe: Probe = { requests: 0 };
    const began = performance.now();
    const running = { value: true };
    const probing = probeUntil(c, probe, () => running.value);
    let records: RolloutRecord[] = [];
    let outcome: unknown;
    try {
      records = await rollAll(c, targets, probe);
    } catch (error) {
      outcome = error;
    }
    running.value = false;
    await probing;
    if (probe.failure !== undefined) {
      throw new Error(
        `a request failed during the rollout drill: ${reason(probe.failure)}`,
      );
    }
    if (outcome !== undefined) {
      throw outcome;
    }
    const after = await c.host.read();
    assert.ok(records.length > 0, "the drill rolled no Deployment");
    assert.ok(probe.requests > 0, "the probe sent no request");

    console.log(
      JSON.stringify(
        drillRecordOf({
          requests: probe.requests,
          rollouts: records,
          elapsedSeconds: Math.round(performance.now() - began) / 1000,
          loadAverage,
          gateway: {
            namespace: c.gateway.namespace,
            name: c.gateway.name,
            port: c.target.port,
          },
          host: { before, after },
        }),
        null,
        2,
      ),
    );
  },
);
