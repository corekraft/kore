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
  k3sHost,
  probeUntil,
  readNodes,
  readPods,
  readReady,
  restartAndSettle,
  sampleUntil,
  warmUp,
} from "./golden-path-k3s-restart-cluster.live.js";
import {
  judgeRestart,
  k3sRestartDrill,
  k3sRestartRecordOf,
  nodesKept,
  podsKept,
  readyVerdict,
  restartRefusalOf,
  type ReadySample,
} from "./golden-path-k3s-restart-support.js";
import {
  reason,
  targetsOf,
  type Probe,
  type Target,
} from "./golden-path-rollout-cluster.live.js";
import { rolloutDrill } from "./golden-path-rollout-support.js";
import { HostConditions } from "./ingress-host.js";
import { loadArgs, type LoadTarget } from "./route-load.js";

// Docs: docs/decisions/0153-rollback-goes-through-the-release-owner-and-host-maintenance-never-drains.md
// Docs: infra/plans/13-agentgateway-ingress.md#golden-path-route-set
// Live: kore-vps, the golden-path example delivered through Argo CD and the shared
// Gateway's proxy running. The coordinator runs it on kore-vps on an idle host, ONE
// RUN AT A TIME. Run with KORE_RUN_LIVE=1 (`npm run test:live:golden-path-k3s-restart`
// in tools/kore). The nightly excludes it (nightly.sh): the night must not restart k3s.
//
// The drill restarts k3s in place (systemctl restart over SSH to kore-vps, no drain)
// while the rollout drill's probe runs through the shared Gateway. It proves, from a
// recorded run: zero failed requests with no retries, no Deployment's ready replicas
// below its minimum wherever the API server answered, and every running pod and the
// node kept. The rules are in golden-path-k3s-restart-support.ts, the cluster steps in
// golden-path-k3s-restart-cluster.live.ts. Refused before the restart: any context but
// kore-vps, a busy host, a service with its own Gateway, a missing target, or an
// unsettled Deployment.

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
  // Refused before any reach or restart: the drill restarts only the kore-vps node.
  const refusal = restartRefusalOf(kubeContext);
  if (refusal !== undefined) {
    throw new Error(refusal);
  }
  const service = process.env.KORE_GOLDEN_PATH_SERVICE ?? "golden-path-example";
  const namespace = `${service}--${name}`;
  const runner = new ProcessRunner();
  const gateway = internalGateway(environment);
  const reach = await goldenPathReach(runner, {
    kubeContext,
    namespace,
    service,
    sharedGateway: { ...gateway, port: gatewayEntryPort },
  });
  if (reach.via !== "shared") {
    throw new Error(
      `the golden-path Service ${namespace}/${service} has its own Gateway; the k3s restart drill proves the shared Gateway, so it cannot run against this Service`,
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

type Context = Awaited<ReturnType<typeof context>>;

/**
 * Runs the probe and the ready-replica sampler beside the restart: the warm-up
 * first, then the restart and the settle wait. Stops both once the restart is
 * done, and rethrows what ended it, so the caller judges only a finished run.
 */
async function restartUnderProbe(c: Context, targets: Target[]) {
  const probe: Probe = { requests: 0 };
  const began = performance.now();
  const running = { value: true };
  const samples: ReadySample[] = [];
  const probing = probeUntil(c, probe, () => running.value);
  const sampling = sampleUntil(c, targets, samples, began, () => running.value);
  // A sampler bug (now rethrown, not swallowed) is raised below once the restart
  // is done; this handler keeps it from ending the process unhandled before then.
  sampling.catch(() => undefined);
  let apiReturnedSeconds = 0;
  let outcome: unknown;
  try {
    await warmUp(probe);
    apiReturnedSeconds = await restartAndSettle(c, targets, probe);
  } catch (error) {
    outcome = error;
  }
  running.value = false;
  await Promise.all([probing, sampling]);
  if (outcome !== undefined) {
    throw outcome;
  }
  return { probe, began, samples, apiReturnedSeconds };
}

test(
  "restarts k3s in place under the probe with zero failed requests, no ready replica below its minimum, and every running pod and the node kept",
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
    // Settled before the restart, so each target's ready count is its settled count: its minimum.
    const minimums = await readReady(c, targets);
    const podsBefore = await readPods(c);
    const nodesBefore = await readNodes(c);

    const { probe, began, samples, apiReturnedSeconds } =
      await restartUnderProbe(c, targets);
    assert.ok(probe.requests > 0, "the probe sent no request");

    const after = await c.host.read();
    const podsAfter = await readPods(c);
    const nodesAfter = await readNodes(c);
    const verdict = readyVerdict(samples, minimums);
    const failures = judgeRestart({
      probeFailure:
        probe.failure === undefined ? undefined : reason(probe.failure),
      verdict,
      pods: podsKept(podsBefore, podsAfter),
      nodes: nodesKept(nodesBefore, nodesAfter),
    });
    if (failures.length > 0) {
      throw new Error(`the k3s restart drill failed: ${failures.join("; ")}`);
    }

    console.log(
      JSON.stringify(
        k3sRestartRecordOf({
          requests: probe.requests,
          elapsedSeconds: Math.round(performance.now() - began) / 1000,
          loadAverage,
          gateway: {
            namespace: c.gateway.namespace,
            name: c.gateway.name,
            port: c.target.port,
          },
          restart: { via: "ssh", host: k3sHost, unit: k3sRestartDrill.unit },
          verdict,
          apiReturnedSeconds,
          pods: { before: podsBefore, after: podsAfter },
          nodes: { before: nodesBefore, after: nodesAfter },
          host: { before, after },
        }),
        null,
        2,
      ),
    );
  },
);
