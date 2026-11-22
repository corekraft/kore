import { beforeEach, expect, test, vi } from "vitest";
import { mergedMilliseconds, stageTimes } from "./delivery-stage-timeline.js";
import {
  COLD,
  MERGED,
  MERGED_MS,
  STAGES,
  timerWith,
} from "./delivery-stage-timer-support.js";

// The merge check and the stage arithmetic are same-domain pure helpers, so they
// are stubs here (ADR 0098). Their own spec proves the arithmetic; the constants
// stay real.
vi.mock("./delivery-stage-timeline.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./delivery-stage-timeline.js")>()),
  mergedMilliseconds: vi.fn(),
  stageTimes: vi.fn(),
}));

// The kubectl argv for one read-only get against the configured context.
const kubectl = (...args: string[]) => [
  "kubectl",
  "--context",
  "k3d-kore-local",
  ...args,
];

beforeEach(() => {
  vi.mocked(mergedMilliseconds).mockReset();
  vi.mocked(stageTimes).mockReset();
  vi.mocked(mergedMilliseconds).mockReturnValue(MERGED_MS);
  vi.mocked(stageTimes).mockReturnValue({ stages: STAGES, totalSeconds: 85 });
});

test("a merge time the timeline refuses fails before any read, and the runner is never called", async () => {
  const message =
    "KORE_DELIVERY_MERGED_AT must be an RFC 3339 time, for example 2026-11-18T10:00:00Z";
  vi.mocked(mergedMilliseconds).mockImplementation(() => {
    throw new Error(message);
  });
  const { timer, run } = timerWith(COLD);

  await expect(timer.measure()).rejects.toThrow(new Error(message));
  expect(run).not.toHaveBeenCalled();
});

test("the timer reads the merge time through the timeline, before any cluster read", async () => {
  const { timer, run } = timerWith(COLD);

  await timer.measure();

  expect(mergedMilliseconds).toHaveBeenCalledExactlyOnceWith(MERGED);
  expect(
    vi.mocked(mergedMilliseconds).mock.invocationCallOrder[0],
  ).toBeLessThan(run.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY);
});

test("the timer passes the timeline the merge time and each stage's end from the cluster, in stage order", async () => {
  const { timer } = timerWith(COLD);

  await timer.measure();

  expect(stageTimes).toHaveBeenCalledExactlyOnceWith(MERGED_MS, [
    ["namespace", Date.parse("2026-11-18T10:00:05Z")],
    ["sync", Date.parse("2026-11-18T10:00:15Z")],
    ["admission", Date.parse("2026-11-18T10:00:17Z")],
    ["certificate", Date.parse("2026-11-18T10:00:50Z")],
    ["rollout", Date.parse("2026-11-18T10:01:20Z")],
    ["readiness", Date.parse("2026-11-18T10:01:25Z")],
  ]);
});

test("a cold delivery reports the stages and total the timeline returns, in the cold series, with its metadata", async () => {
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
      stages: STAGES,
      totalSeconds: 85,
      excluded: ["tenant build"],
    },
  ]);
});

test("a namespace created before the merge is a redeploy series, and the timeline is given that namespace end", async () => {
  const { timer } = timerWith({
    ...COLD,
    namespace: { metadata: { creationTimestamp: "2026-11-17T09:50:00Z" } },
  });

  const report = await timer.measure();

  expect(report.cold).toEqual([]);
  expect(report.redeploy).toEqual([
    expect.objectContaining({ series: "redeploy", stages: STAGES }),
  ]);
  expect(vi.mocked(stageTimes).mock.calls[0]?.[1][0]).toEqual([
    "namespace",
    Date.parse("2026-11-17T09:50:00Z"),
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
    kubectl("get", "namespace", "shop--local", "-o", "json"),
    kubectl(
      "-n",
      "argocd",
      "get",
      "application",
      "golden-path-shop",
      "-o",
      "json",
    ),
    kubectl(
      "-n",
      "shop--local",
      "get",
      "pods",
      "-l",
      "app.kubernetes.io/part-of=shop",
      "-o",
      "json",
    ),
    kubectl(
      "-n",
      "shop--local",
      "get",
      "httproute",
      "shop-shared",
      "-o",
      "json",
    ),
    kubectl(
      "-n",
      "shop--local",
      "get",
      "certificate",
      "shop-tls",
      "-o",
      "json",
    ),
    kubectl(
      "-n",
      "shop--local",
      "get",
      "deployments",
      "-l",
      "app.kubernetes.io/part-of=shop",
      "-o",
      "json",
    ),
  ]);
});
