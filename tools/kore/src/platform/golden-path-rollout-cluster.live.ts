import assert from "node:assert/strict";
import type { Runner } from "../runtime/index.js";
import { goldenPathRouteSet } from "./golden-path-routes.js";
import {
  deploymentOf,
  rolloutDrill,
  belowMinimum,
  settled,
  type Deployment,
  type DeploymentDocument,
  type RolloutRecord,
} from "./golden-path-rollout-support.js";
import { countRound, loadArgs, type LoadTarget } from "./route-load.js";

// Docs: infra/plans/13-agentgateway-ingress.md#golden-path-route-set
//
// The cluster half of the golden-path rollout drill, used by
// golden-path-rollout.live.spec.ts: the reads, the restarts, the probe loop and
// the rollout waits. The rules it applies are in golden-path-rollout-support.ts.

export interface RolloutContext {
  runner: Runner;
  kubeContext: string;
  /** The service namespace, `<service>--<environment>`. */
  namespace: string;
  gateway: { namespace: string; name: string };
  /** The probe's target: the service host through the shared Gateway. */
  target: LoadTarget;
}

export interface Target {
  role: RolloutRecord["role"];
  namespace: string;
  name: string;
}

/** The probe's state: requests answered as expected, and the first failure, which ends it. */
export interface Probe {
  requests: number;
  failure?: unknown;
}

const tenth = (value: number): number => Math.round(value * 10) / 10;
export const reason = (error: unknown): string =>
  error instanceof Error ? error.message : JSON.stringify(error);
const sleep = (seconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));

function kubectl(c: RolloutContext, namespace: string, args: string[]) {
  return c.runner.run(
    "kubectl",
    ["--context", c.kubeContext, "--namespace", namespace, ...args],
    { capture: true },
  );
}

async function readDeployment(
  c: RolloutContext,
  target: Target,
): Promise<Deployment> {
  const { stdout } = await kubectl(c, target.namespace, [
    "get",
    "deployment",
    target.name,
    "--output",
    "json",
  ]);
  return deploymentOf(JSON.parse(stdout) as DeploymentDocument);
}

async function listTargets(
  c: RolloutContext,
  namespace: string,
  role: Target["role"],
  selector?: string,
): Promise<Target[]> {
  const { stdout } = await kubectl(c, namespace, [
    "get",
    "deployments",
    ...(selector === undefined ? [] : ["--selector", selector]),
    "--output",
    "json",
  ]);
  const items = (JSON.parse(stdout) as { items?: DeploymentDocument[] }).items;
  return (items ?? []).map((item) => ({
    role,
    namespace,
    name: deploymentOf(item).name,
  }));
}

/**
 * Every Deployment of the service's release (its namespace holds only those),
 * then the shared Gateway's proxy Deployments, found by the gateway-name label that
 * both GatewayClasses set on the proxy (gateway-proxy-budget.yaml). Refuses any
 * Deployment that is not settled, before anything is restarted.
 */
export async function targetsOf(c: RolloutContext): Promise<Target[]> {
  const apps = await listTargets(c, c.namespace, "app");
  if (apps.length === 0) {
    throw new Error(
      `the namespace ${c.namespace} has no Deployment; deliver the golden-path service and let Argo CD converge before rerunning`,
    );
  }
  const selector = `gateway.networking.k8s.io/gateway-name=${c.gateway.name}`;
  const proxies = await listTargets(
    c,
    c.gateway.namespace,
    "gateway-proxy",
    selector,
  );
  if (proxies.length === 0) {
    throw new Error(
      `no Deployment in ${c.gateway.namespace} carries the label ${selector}; the shared Gateway's proxy cannot be rolled, so the drill cannot prove the gateway side`,
    );
  }
  const targets = [...apps, ...proxies];
  for (const target of targets) {
    assert.ok(
      settled(await readDeployment(c, target)),
      `${target.namespace}/${target.name} is not settled; the drill refuses before restarting anything`,
    );
  }
  return targets;
}

/** Repeats the golden-path rounds through the shared Gateway until `running` turns false or one request fails. */
export async function probeUntil(
  c: RolloutContext,
  probe: Probe,
  running: () => boolean,
): Promise<void> {
  try {
    do {
      for (const route of goldenPathRouteSet.routes) {
        const { stdout } = await c.runner.run(
          "curl",
          loadArgs(c.target, route.path),
          { capture: true },
        );
        probe.requests += countRound(
          route,
          stdout,
          rolloutDrill.requestsPerRoute,
        );
        if (!running()) {
          return;
        }
      }
    } while (running());
  } catch (error) {
    probe.failure = error;
  }
}

/** Throws the probe's first failure, if it has one, before anything else is done. */
function refuseOnFailure(probe: Probe, before: string): void {
  if (probe.failure !== undefined) {
    throw new Error(`a request failed ${before}: ${reason(probe.failure)}`);
  }
}

/** The first full round must answer before any rollout starts; a failure or the warm-up budget ends the wait. */
async function warmUp(probe: Probe): Promise<void> {
  const round =
    goldenPathRouteSet.routes.length * rolloutDrill.requestsPerRoute;
  for (let waited = 0; ; waited += 1) {
    refuseOnFailure(probe, "before any rollout");
    if (probe.requests >= round) {
      return;
    }
    if (waited >= rolloutDrill.warmupTimeoutSeconds) {
      throw new Error(
        `the probe answered ${probe.requests} of ${round} requests in ${rolloutDrill.warmupTimeoutSeconds} seconds before any rollout; check the shared Gateway answers the golden-path routes`,
      );
    }
    await sleep(rolloutDrill.pollIntervalSeconds);
  }
}

/** Restarts one Deployment and reads it until its rollout settles, failing on a ready dip or a timeout. */
async function rollOut(
  c: RolloutContext,
  target: Target,
  probe: Probe,
): Promise<RolloutRecord> {
  const subject = `${target.namespace}/${target.name}`;
  // Nothing new is restarted once a request has failed, not even the next target.
  refuseOnFailure(probe, `before ${subject} was restarted`);
  const before = await readDeployment(c, target);
  assert.ok(
    settled(before),
    `${subject} is not settled before its restart; the drill refuses to restart it`,
  );
  const minimumReady = before.desired;
  await kubectl(c, target.namespace, [
    "rollout",
    "restart",
    `deployment/${target.name}`,
  ]);
  const began = performance.now();
  let lowestReady = before.ready;
  let samples = 0;
  for (;;) {
    const current = await readDeployment(c, target);
    samples += 1;
    lowestReady = Math.min(lowestReady, current.ready);
    if (belowMinimum(current, minimumReady)) {
      throw new Error(
        `${subject} had ${current.ready} ready replicas during its rollout, below its minimum of ${minimumReady}; the rollout took capacity the release needs (ADR 0154: one surge Pod at a time, under a disruption budget)`,
      );
    }
    if (settled(current)) {
      break;
    }
    if (probe.failure !== undefined) {
      throw new Error(
        `a request failed while ${subject} rolled out: ${reason(probe.failure)}`,
      );
    }
    if (
      performance.now() - began >=
      rolloutDrill.rolloutTimeoutSeconds * 1000
    ) {
      throw new Error(
        `${subject} did not finish its rollout within ${rolloutDrill.rolloutTimeoutSeconds} seconds: ${current.updated} of ${current.desired} replicas updated and ${current.ready} ready; check the Pods' events`,
      );
    }
    await sleep(rolloutDrill.pollIntervalSeconds);
  }
  return {
    role: target.role,
    deployment: subject,
    minimumReady,
    lowestReady,
    samples,
    elapsedSeconds: tenth((performance.now() - began) / 1000),
  };
}

/** Rolls every target in turn while the probe runs; the records come back in rollout order. */
export async function rollAll(
  c: RolloutContext,
  targets: Target[],
  probe: Probe,
): Promise<RolloutRecord[]> {
  await warmUp(probe);
  const records: RolloutRecord[] = [];
  for (const target of targets) {
    records.push(await rollOut(c, target, probe));
  }
  return records;
}
