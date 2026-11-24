import type { Runner } from "../runtime/index.js";
import {
  deploymentOf,
  rolloutDrill,
  settled,
  type Deployment,
  type DeploymentDocument,
} from "./golden-path-rollout-support.js";
import {
  reason,
  type Probe,
  type RolloutContext,
  type Target,
} from "./golden-path-rollout-cluster.live.js";
import {
  k3sRestartDrill,
  nodesOf,
  podsOf,
  type NodeListDocument,
  type NodeState,
  type PodListDocument,
  type PodState,
  type ReadySample,
} from "./golden-path-k3s-restart-support.js";
import { countRound, loadArgs } from "./route-load.js";
import { goldenPathRouteSet } from "./golden-path-routes.js";

// Docs: docs/decisions/0153-rollback-goes-through-the-release-owner-and-host-maintenance-never-drains.md
//
// The cluster half of the in-place k3s restart drill, used by
// golden-path-k3s-restart.live.spec.ts: the restart over SSH, the API server's
// return, the ready-replica samples, the pod and node reads and the probe loop.
// The rules it applies are in golden-path-k3s-restart-support.ts.

/**
 * The kore-vps host, reached by Tailscale SSH as the README documents
 * (infra/hosts/vps/README.md). The restart names the host; no current context is used.
 */
export const k3sHost = "debian@kore-vps";

const tenth = (value: number): number => Math.round(value * 10) / 10;
const sleep = (seconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
const elapsedSeconds = (since: number): number =>
  tenth((performance.now() - since) / 1000);

function kubectl(
  c: RolloutContext,
  namespace: string | undefined,
  args: string[],
) {
  return c.runner.run(
    "kubectl",
    [
      "--context",
      c.kubeContext,
      ...(namespace === undefined ? [] : ["--namespace", namespace]),
      ...args,
      "--request-timeout=10s",
    ],
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

/** The ready replicas of each target, keyed by `<namespace>/<name>`; one unanswered read fails the whole reading. */
export async function readReady(
  c: RolloutContext,
  targets: Target[],
): Promise<Record<string, number>> {
  const ready: Record<string, number> = {};
  for (const target of targets) {
    const deployment = await readDeployment(c, target);
    ready[`${target.namespace}/${target.name}`] = deployment.ready;
  }
  return ready;
}

/** Whether every target is settled now. An unanswered read counts as not settled yet. */
async function allSettled(
  c: RolloutContext,
  targets: Target[],
): Promise<boolean> {
  try {
    for (const target of targets) {
      if (!settled(await readDeployment(c, target))) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Whether the API server answers its readiness endpoint, so reads can resume. */
async function apiAnswers(c: RolloutContext): Promise<boolean> {
  try {
    await kubectl(c, undefined, ["get", "--raw", "/readyz"]);
    return true;
  } catch {
    return false;
  }
}

/** The pods of the service and the shared Gateway's namespaces, read as the pod checks need them. */
export async function readPods(c: RolloutContext): Promise<PodState[]> {
  const pods: PodState[] = [];
  for (const namespace of [c.namespace, c.gateway.namespace]) {
    const { stdout } = await kubectl(c, namespace, [
      "get",
      "pods",
      "--output",
      "json",
    ]);
    pods.push(...podsOf(JSON.parse(stdout) as PodListDocument));
  }
  return pods;
}

/** The cluster's nodes, read as the node check needs them. */
export async function readNodes(c: RolloutContext): Promise<NodeState[]> {
  const { stdout } = await kubectl(c, undefined, [
    "get",
    "nodes",
    "--output",
    "json",
  ]);
  return nodesOf(JSON.parse(stdout) as NodeListDocument);
}

/**
 * Restarts k3s in place over SSH. Names the host and the unit, and says what to
 * check when the SSH link or the account's sudo fails, so the failure is actionable.
 */
export async function restartK3s(runner: Runner): Promise<void> {
  try {
    await runner.run(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=15",
        k3sHost,
        "sudo",
        "-n",
        "systemctl",
        "restart",
        k3sRestartDrill.unit,
      ],
      { capture: true },
    );
  } catch (error) {
    throw new Error(
      `restarting ${k3sRestartDrill.unit} over ssh to ${k3sHost} failed: ${reason(error)}; check the Tailscale SSH link to kore-vps and that its debian account runs systemctl with sudo -n`,
    );
  }
}

/**
 * Samples the targets' ready replicas each interval until `running` turns false.
 * A reading the API server does not answer is recorded as unanswered, not as a dip.
 */
export async function sampleUntil(
  c: RolloutContext,
  targets: Target[],
  samples: ReadySample[],
  began: number,
  running: () => boolean,
): Promise<void> {
  while (running()) {
    const seconds = elapsedSeconds(began);
    try {
      samples.push({
        seconds,
        answered: true,
        ready: await readReady(c, targets),
      });
    } catch {
      samples.push({ seconds, answered: false, ready: {} });
    }
    await sleep(k3sRestartDrill.sampleIntervalSeconds);
  }
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
export function refuseOnFailure(probe: Probe, before: string): void {
  if (probe.failure !== undefined) {
    throw new Error(`a request failed ${before}: ${reason(probe.failure)}`);
  }
}

/** The first full round must answer before the restart is sent; a failure or the warm-up budget ends the wait. */
export async function warmUp(probe: Probe): Promise<void> {
  const round =
    goldenPathRouteSet.routes.length * rolloutDrill.requestsPerRoute;
  for (let waited = 0; ; waited += 1) {
    refuseOnFailure(probe, "before k3s was restarted");
    if (probe.requests >= round) {
      return;
    }
    if (waited >= rolloutDrill.warmupTimeoutSeconds) {
      throw new Error(
        `the probe answered ${probe.requests} of ${round} requests in ${rolloutDrill.warmupTimeoutSeconds} seconds before the restart; check the shared Gateway answers the golden-path routes`,
      );
    }
    await sleep(rolloutDrill.pollIntervalSeconds);
  }
}

/**
 * Restarts k3s, waits for the API server to answer, then for every target to
 * settle, and holds the probe for a while after that. Returns the seconds from the
 * restart until the API server answered. A probe failure ends the wait by name.
 */
export async function restartAndSettle(
  c: RolloutContext,
  targets: Target[],
  probe: Probe,
): Promise<number> {
  await restartK3s(c.runner);
  const restarted = performance.now();
  for (;;) {
    refuseOnFailure(probe, "while k3s restarted");
    if (await apiAnswers(c)) {
      break;
    }
    if (elapsedSeconds(restarted) >= k3sRestartDrill.apiTimeoutSeconds) {
      throw new Error(
        `the API server did not answer within ${k3sRestartDrill.apiTimeoutSeconds} seconds of the k3s restart; check the k3s unit on kore-vps with journalctl`,
      );
    }
    await sleep(rolloutDrill.pollIntervalSeconds);
  }
  const apiReturnedSeconds = elapsedSeconds(restarted);
  for (;;) {
    refuseOnFailure(probe, "after k3s came back");
    if (await allSettled(c, targets)) {
      break;
    }
    if (elapsedSeconds(restarted) >= rolloutDrill.rolloutTimeoutSeconds) {
      throw new Error(
        `the Deployments did not settle within ${rolloutDrill.rolloutTimeoutSeconds} seconds of the k3s restart; check their Pods' events`,
      );
    }
    await sleep(rolloutDrill.pollIntervalSeconds);
  }
  for (let held = 0; held < k3sRestartDrill.holdSeconds; held += 1) {
    refuseOnFailure(probe, "while the probe held after the restart");
    await sleep(k3sRestartDrill.sampleIntervalSeconds);
  }
  return apiReturnedSeconds;
}
