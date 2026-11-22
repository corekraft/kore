import type { StageTime } from "./delivery-stage-timeline.js";
import { fakeRunner } from "./platform-support.js";
import {
  DeliveryStageTimer,
  type DeliveryTimerOptions,
} from "./delivery-stage-timer.js";

// The fixtures and the fake cluster the delivery-stage timer's unit specs share.
// Each spec stubs the stage arithmetic itself (ADR 0098).

export const MERGED = "2026-11-18T10:00:00Z";
export const MERGED_MS = Date.parse(MERGED);

export const options: DeliveryTimerOptions = {
  service: "shop",
  environment: "local",
  kubeContext: "k3d-kore-local",
  host: "shop.platform.kore.internal",
  mergedAt: MERGED,
};

// The stage seconds the timeline stub hands back, so the timer's report can be
// checked for carrying them as they are.
export const STAGES: StageTime[] = [
  { stage: "namespace", seconds: 5 },
  { stage: "sync", seconds: 10 },
  { stage: "admission", seconds: 2 },
  { stage: "certificate", seconds: 33 },
  { stage: "rollout", seconds: 30 },
  { stage: "readiness", seconds: 5 },
];

// kubectl's NotFound for an object that is not there. The two optional sources
// of the certificate stage are read as absent on it; any other failed read fails.
export const NOT_FOUND = Symbol("not found");

// The Service's shared HTTPRoute, Accepted by its parent (the shared Gateway) at
// 10:00:40, ten seconds before the Certificate's Ready time, so a read of the
// wrong source would show.
export const SHARED_ROUTE = {
  status: {
    parents: [
      {
        conditions: [
          {
            type: "Accepted",
            status: "True",
            lastTransitionTime: "2026-11-18T10:00:40Z",
          },
          {
            type: "ResolvedRefs",
            status: "True",
            lastTransitionTime: "2026-11-18T10:00:41Z",
          },
        ],
      },
    ],
  },
};

// One cluster state for a cold delivery of `shop`, merged at MERGED. Each
// stage's time source is a field of the object that carries it. The Service has
// no shared route, so its certificate is the stage's source.
export const COLD = {
  namespace: { metadata: { creationTimestamp: "2026-11-18T10:00:05Z" } },
  route: NOT_FOUND,
  application: {
    status: { operationState: { finishedAt: "2026-11-18T10:00:15Z" } },
  },
  pods: {
    items: [
      { metadata: { creationTimestamp: "2026-11-18T10:00:17Z" } },
      { metadata: { creationTimestamp: "2026-11-18T10:00:19Z" } },
    ],
  },
  certificate: {
    status: {
      conditions: [
        {
          type: "Ready",
          status: "True",
          lastTransitionTime: "2026-11-18T10:00:50Z",
        },
      ],
    },
  },
  deployments: {
    items: [
      {
        status: {
          conditions: [
            {
              type: "Progressing",
              status: "True",
              reason: "NewReplicaSetAvailable",
              lastUpdateTime: "2026-11-18T10:01:20Z",
            },
            {
              type: "Available",
              status: "True",
              lastTransitionTime: "2026-11-18T10:01:25Z",
            },
          ],
        },
      },
      {
        status: {
          conditions: [
            {
              type: "Progressing",
              status: "True",
              reason: "NewReplicaSetAvailable",
              lastUpdateTime: "2026-11-18T10:01:10Z",
            },
            {
              type: "Available",
              status: "True",
              lastTransitionTime: "2026-11-18T10:01:12Z",
            },
          ],
        },
      },
    ],
  },
};

// A cluster state keyed by resource; an undefined key is a read that fails, and
// NOT_FOUND is a read of an object that is not there.
export type Cluster = Record<string, unknown>;

// Replies to the read-only kubectl gets the timer makes, keyed by the resource
// named after `get`.
export function clusterReply(cluster: Cluster) {
  const byResource: Record<string, unknown> = {
    namespace: cluster.namespace,
    application: cluster.application,
    pods: cluster.pods,
    httproute: cluster.route,
    certificate: cluster.certificate,
    deployments: cluster.deployments,
  };
  return (command: string, args: readonly string[]): string => {
    const resource = args[args.indexOf("get") + 1] ?? "";
    const reply = byResource[resource];
    if (reply === undefined) {
      throw new Error(`unexpected read ${command} ${args.join(" ")}`);
    }
    if (reply === NOT_FOUND) {
      throw new Error(
        `${command} ${args.join(" ")} failed (1): Error from server (NotFound): ${resource} "${args[args.indexOf("get") + 2]}" not found`,
      );
    }
    return JSON.stringify(reply);
  };
}

export function timerWith(cluster: Cluster) {
  const { runner, run } = fakeRunner(clusterReply(cluster));
  const timer = new DeliveryStageTimer(runner, options, {
    now: () => Date.parse("2026-11-18T10:05:00Z"),
  });
  return { timer, run };
}

export // The resource each read-only get names, in the order the timer made the reads.
function readOrder(run: ReturnType<typeof fakeRunner>["run"]): string[] {
  return run.mock.calls.map(([, args]) => args[args.indexOf("get") + 1] ?? "");
}
