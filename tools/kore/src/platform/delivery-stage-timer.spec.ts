import { expect, test } from "vitest";
import { fakeRunner } from "./platform-support.js";
import {
  DeliveryStageTimer,
  type DeliveryTimerOptions,
} from "./delivery-stage-timer.js";

const MERGED = "2026-11-18T10:00:00Z";

const options: DeliveryTimerOptions = {
  service: "shop",
  environment: "local",
  kubeContext: "k3d-kore-local",
  host: "shop.platform.kore.internal",
  mergedAt: MERGED,
};

// One cluster state for a cold delivery of `shop`, merged at MERGED. Each
// stage's time source is a field of the object that carries it.
const COLD = {
  namespace: { metadata: { creationTimestamp: "2026-11-18T10:00:05Z" } },
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

// A cluster state keyed by resource; an absent or undefined key is a read that fails.
type Cluster = Record<string, unknown>;

// Replies to the read-only kubectl gets the timer makes, keyed by the resource
// named after `get`. A missing resource in `cluster` is a read that fails.
function clusterReply(cluster: Cluster) {
  const byResource: Record<string, unknown> = {
    namespace: cluster.namespace,
    application: cluster.application,
    pods: cluster.pods,
    certificate: cluster.certificate,
    deployments: cluster.deployments,
  };
  return (command: string, args: readonly string[]): string => {
    const resource = args[args.indexOf("get") + 1] ?? "";
    const reply = byResource[resource];
    if (reply === undefined) {
      throw new Error(`unexpected read ${command} ${args.join(" ")}`);
    }
    return JSON.stringify(reply);
  };
}

function timerWith(cluster: Cluster) {
  const { runner, run } = fakeRunner(clusterReply(cluster));
  const timer = new DeliveryStageTimer(runner, options, {
    now: () => Date.parse("2026-11-18T10:05:00Z"),
  });
  return { timer, run };
}

test("a merge time that is not RFC 3339 fails before any read, and the runner is never called", async () => {
  const { runner, run } = fakeRunner(clusterReply(COLD));
  const timer = new DeliveryStageTimer(
    runner,
    { ...options, mergedAt: "2026-11-18 10:00:00" },
    { now: () => Date.parse("2026-11-18T10:05:00Z") },
  );

  await expect(timer.measure()).rejects.toThrow(
    new Error(
      "KORE_DELIVERY_MERGED_AT must be an RFC 3339 time, for example 2026-11-18T10:00:00Z",
    ),
  );
  expect(run).not.toHaveBeenCalled();
});

test("a merge time with a numeric offset is an RFC 3339 time and is measured", async () => {
  const { runner } = fakeRunner(clusterReply(COLD));
  const timer = new DeliveryStageTimer(
    runner,
    { ...options, mergedAt: "2026-11-18T11:00:00+01:00" },
    { now: () => Date.parse("2026-11-18T10:05:00Z") },
  );

  const report = await timer.measure();

  expect(report.cold.map((run) => run.totalSeconds)).toEqual([85]);
});

test("a cold delivery times the six stages from the merge, in stage order, with the total", async () => {
  const { timer } = timerWith(COLD);

  const report = await timer.measure();

  expect(report.redeploy).toEqual([]);
  expect(report.cold).toEqual([
    {
      series: "cold",
      service: "shop",
      host: "shop.platform.kore.internal",
      mergedAt: MERGED,
      measuredAt: "2026-11-18T10:05:00.000Z",
      stages: [
        { stage: "namespace", seconds: 5 },
        { stage: "sync", seconds: 10 },
        { stage: "admission", seconds: 2 },
        { stage: "certificate", seconds: 33 },
        { stage: "rollout", seconds: 30 },
        { stage: "readiness", seconds: 5 },
      ],
      totalSeconds: 85,
      excluded: ["tenant build"],
    },
  ]);
});

test("a namespace created before the merge is a redeploy, reported in its own series, and its stage takes no time", async () => {
  const { timer } = timerWith({
    ...COLD,
    namespace: { metadata: { creationTimestamp: "2026-11-17T09:50:00Z" } },
  });

  const report = await timer.measure();

  expect(report.cold).toEqual([]);
  expect(report.redeploy).toEqual([
    expect.objectContaining({
      series: "redeploy",
      stages: [
        { stage: "namespace", seconds: 0 },
        { stage: "sync", seconds: 15 },
        { stage: "admission", seconds: 2 },
        { stage: "certificate", seconds: 33 },
        { stage: "rollout", seconds: 30 },
        { stage: "readiness", seconds: 5 },
      ],
      totalSeconds: 85,
    }),
  ]);
});

test("a certificate with no Ready=True condition fails the run naming the certificate stage", async () => {
  const { timer } = timerWith({
    ...COLD,
    certificate: { status: { conditions: [] } },
  });

  await expect(timer.measure()).rejects.toThrow(
    new Error(
      'delivery stage "certificate" has no time source: Certificate shop-tls has no True Ready condition',
    ),
  );
});

test("an Argo CD Application with no sync finish time fails the run naming the sync stage", async () => {
  const { timer } = timerWith({ ...COLD, application: { status: {} } });

  await expect(timer.measure()).rejects.toThrow(
    new Error(
      'delivery stage "sync" has no time source: Application golden-path-shop operationState.finishedAt is missing or not a timestamp',
    ),
  );
});

test("a read that fails names the stage and the context to check, and reports no total", async () => {
  const { timer } = timerWith({ ...COLD, certificate: undefined });

  await expect(timer.measure()).rejects.toThrow(
    new Error(
      'delivery stage "certificate" has no time source: reading the certificate shop-tls failed: unexpected read kubectl --context k3d-kore-local -n shop--local get certificate shop-tls -o json; check that kubectl can reach the k3d-kore-local context',
    ),
  );
});

test("reads only with kubectl get, against the configured context, each time source once", async () => {
  const { timer, run } = timerWith(COLD);

  await timer.measure();

  expect(run.mock.calls.map(([command, args]) => [command, ...args])).toEqual([
    [
      "kubectl",
      "--context",
      "k3d-kore-local",
      "get",
      "namespace",
      "shop--local",
      "-o",
      "json",
    ],
    [
      "kubectl",
      "--context",
      "k3d-kore-local",
      "-n",
      "argocd",
      "get",
      "application",
      "golden-path-shop",
      "-o",
      "json",
    ],
    [
      "kubectl",
      "--context",
      "k3d-kore-local",
      "-n",
      "shop--local",
      "get",
      "pods",
      "-l",
      "app.kubernetes.io/part-of=shop",
      "-o",
      "json",
    ],
    [
      "kubectl",
      "--context",
      "k3d-kore-local",
      "-n",
      "shop--local",
      "get",
      "certificate",
      "shop-tls",
      "-o",
      "json",
    ],
    [
      "kubectl",
      "--context",
      "k3d-kore-local",
      "-n",
      "shop--local",
      "get",
      "deployments",
      "-l",
      "app.kubernetes.io/part-of=shop",
      "-o",
      "json",
    ],
  ]);
});
