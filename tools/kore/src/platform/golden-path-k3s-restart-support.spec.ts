import { describe, expect, test } from "vitest";
import {
  judgeRestart,
  k3sRestartDrill,
  k3sRestartRecordOf,
  nodesKept,
  nodesOf,
  podsKept,
  podsOf,
  readyVerdict,
  restartRefusalOf,
  type NodeState,
  type PodState,
  type ReadySample,
} from "./golden-path-k3s-restart-support.js";

const pod = (overrides: Partial<PodState> = {}): PodState => ({
  namespace: "golden-path-example--vps",
  name: "golden-path-example-bff-7d9f",
  uid: "uid-bff",
  phase: "Running",
  restarts: 0,
  ...overrides,
});

const node: NodeState = {
  name: "kore-vps",
  uid: "uid-node",
  unschedulable: false,
};

const bffKey = "golden-path-example--vps/golden-path-example-bff";
const proxyKey = "kore-system/kore-gateway";
const minimums = { [bffKey]: 2, [proxyKey]: 1 };
const steady = { [bffKey]: 2, [proxyKey]: 1 };

const answered = (
  seconds: number,
  ready: Record<string, number>,
): ReadySample => ({ seconds, answered: true, ready });
const unanswered = (seconds: number): ReadySample => ({
  seconds,
  answered: false,
  ready: {},
});

describe("the restart is only sent to kore-vps", () => {
  test("accepts the kore-vps context the environment names", () => {
    expect(restartRefusalOf("kore-vps")).toBeUndefined();
  });

  test("refuses any other context, naming the one it requires", () => {
    expect(restartRefusalOf("k3d-kore-local")).toMatch(/kore-vps/);
    expect(restartRefusalOf("")).toMatch(/kore-vps/);
  });

  test("names the unit the drill restarts, in place", () => {
    expect(k3sRestartDrill.unit).toBe("k3s");
  });
});

describe("reading the pods the drill checks", () => {
  test("reads each pod's namespace, name, uid, phase and restart count", () => {
    expect(
      podsOf({
        items: [
          {
            metadata: {
              name: "golden-path-example-bff-7d9f",
              namespace: "golden-path-example--vps",
              uid: "uid-bff",
            },
            status: {
              phase: "Running",
              containerStatuses: [{ restartCount: 1 }, { restartCount: 2 }],
            },
          },
        ],
      }),
    ).toEqual([pod({ restarts: 3 })]);
  });

  test("refuses a pod with no name, rather than checking an unnamed Pod", () => {
    expect(() => podsOf({ items: [{ metadata: { uid: "x" } }] })).toThrow(
      /no metadata.name/,
    );
  });
});

describe("the pods still running after the restart", () => {
  test("keeps every running pod when the same Pods, with no new restarts, are still running", () => {
    expect(podsKept([pod()], [pod()])).toEqual([]);
  });

  test("names a running pod that was replaced or evicted: its uid is gone", () => {
    expect(podsKept([pod()], [pod({ uid: "uid-new" })])).toEqual([
      expect.stringMatching(
        /golden-path-example-bff-7d9f.*replaced or evicted/,
      ),
    ]);
  });

  test("names a pod that restarted its containers, since the drill must not restart them", () => {
    expect(podsKept([pod()], [pod({ restarts: 1 })])).toEqual([
      expect.stringMatching(/golden-path-example-bff-7d9f.*restarted/),
    ]);
  });

  test("names a pod that is no longer Running", () => {
    expect(podsKept([pod()], [pod({ phase: "Pending" })])).toEqual([
      expect.stringMatching(/golden-path-example-bff-7d9f.*Pending/),
    ]);
  });

  test("does not require a completed pod to survive, since a finished Job's Pod is not running", () => {
    expect(podsKept([pod({ phase: "Succeeded" })], [])).toEqual([]);
  });
});

describe("the node is not drained", () => {
  test("reads the node's name, uid and whether it is cordoned", () => {
    expect(
      nodesOf({
        items: [{ metadata: { name: "kore-vps", uid: "uid-node" }, spec: {} }],
      }),
    ).toEqual([node]);
  });

  test("keeps the node when it is the same node and still schedulable", () => {
    expect(nodesKept([node], [node])).toEqual([]);
  });

  test("names a node that became unschedulable, which is what a drain leaves behind", () => {
    expect(nodesKept([node], [{ ...node, unschedulable: true }])).toEqual([
      expect.stringMatching(/kore-vps.*unschedulable/),
    ]);
  });

  test("names a node that is gone or replaced", () => {
    expect(nodesKept([node], [{ ...node, uid: "uid-other" }])).toEqual([
      expect.stringMatching(/kore-vps.*replaced/),
    ]);
  });
});

describe("the ready replicas the answered readings show", () => {
  test("passes when every answered sample holds each Deployment at its minimum", () => {
    const verdict = readyVerdict(
      [answered(0, steady), answered(1, steady)],
      minimums,
    );
    expect(verdict.dips).toEqual([]);
    expect(verdict.unansweredSamples).toBe(0);
  });

  test("names a Deployment whose answered ready count fell below its minimum", () => {
    const verdict = readyVerdict(
      [answered(0, steady), answered(1, { ...steady, [bffKey]: 1 })],
      minimums,
    );
    expect(verdict.dips).toEqual([
      expect.stringMatching(
        /golden-path-example--vps\/golden-path-example-bff.*1 ready.*minimum of 2/,
      ),
    ]);
  });

  test("does not count an unanswered sample as a dip, because the API server was restarting", () => {
    const verdict = readyVerdict(
      [answered(0, steady), unanswered(1), answered(2, steady)],
      minimums,
    );
    expect(verdict.dips).toEqual([]);
    expect(verdict.unansweredSamples).toBe(1);
  });

  test("names a Deployment that no answered sample ever read, so a silent gap cannot pass", () => {
    const verdict = readyVerdict(
      [answered(0, { [bffKey]: 2 }), answered(1, { [bffKey]: 2 })],
      minimums,
    );
    expect(verdict.dips).toEqual([
      expect.stringMatching(/kore-system\/kore-gateway.*never read/),
    ]);
  });

  test("records the lowest answered ready count of each Deployment against its minimum", () => {
    const verdict = readyVerdict(
      [answered(0, steady), answered(1, steady)],
      minimums,
    );
    expect(verdict.deployments).toEqual([
      {
        deployment: bffKey,
        minimumReady: 2,
        lowestReady: 2,
        answeredSamples: 2,
      },
      {
        deployment: proxyKey,
        minimumReady: 1,
        lowestReady: 1,
        answeredSamples: 2,
      },
    ]);
  });
});

describe("the API outage the unanswered readings cover", () => {
  test("counts the unanswered readings and the longest run of them in a row", () => {
    const verdict = readyVerdict(
      [
        answered(0, steady),
        unanswered(1),
        unanswered(2),
        unanswered(3),
        answered(4, steady),
        unanswered(5),
        answered(6, steady),
      ],
      minimums,
    );
    expect(verdict.unansweredSamples).toBe(4);
    expect(verdict.longestUnansweredRun).toBe(3);
    expect(verdict.longestUnansweredSeconds).toBe(3);
  });

  test("measures the outage on the clock, so one slow read that spans many seconds is not undercounted", () => {
    const verdict = readyVerdict(
      [answered(0, steady), unanswered(1), answered(11, steady)],
      minimums,
    );
    expect(verdict.longestUnansweredRun).toBe(1);
    expect(verdict.longestUnansweredSeconds).toBe(10);
  });

  test("counts a run still open at the end of the drill to one interval past its last reading", () => {
    const verdict = readyVerdict(
      [answered(0, steady), unanswered(5)],
      minimums,
    );
    expect(verdict.longestUnansweredSeconds).toBe(
      k3sRestartDrill.sampleIntervalSeconds,
    );
  });
});

describe("the restart's verdict", () => {
  const clean = readyVerdict([answered(0, steady)], steady);

  test("passes when the probe, the ready replicas, the pods and the node all hold", () => {
    expect(judgeRestart({ verdict: clean, pods: [], nodes: [] })).toEqual([]);
  });

  test("fails on a request that failed during the restart, whatever else held", () => {
    expect(
      judgeRestart({
        probeFailure: "curl exited 28",
        verdict: clean,
        pods: [],
        nodes: [],
      }),
    ).toEqual([expect.stringMatching(/a request failed.*curl exited 28/)]);
  });

  test("collects the pod and node violations beside the ready dips", () => {
    const dipped = readyVerdict(
      [answered(0, { ...steady, [bffKey]: 1 })],
      minimums,
    );
    expect(
      judgeRestart({
        verdict: dipped,
        pods: ["pod a was replaced or evicted"],
        nodes: ["node b is unschedulable"],
      }),
    ).toHaveLength(3);
  });
});

describe("the record the drill prints", () => {
  test("records zero failed requests and zero retries, the gateway error ratio as shadow, and the unanswered reads beside the ready floors", () => {
    const record = k3sRestartRecordOf({
      requests: 120,
      elapsedSeconds: 95.5,
      loadAverage: 0.4,
      gateway: { namespace: "kore-system", name: "kore-gateway", port: 443 },
      restart: { via: "ssh", host: "debian@kore-vps", unit: "k3s" },
      verdict: readyVerdict(
        [answered(0, steady), unanswered(1), answered(2, steady)],
        steady,
      ),
      apiReturnedSeconds: 42,
      pods: { before: [pod()], after: [pod()] },
      nodes: { before: [node], after: [node] },
      host: { before: { load: 0.1 }, after: { load: 0.2 } },
    });
    expect(record.load).toEqual({
      requests: 120,
      failedRequests: 0,
      retries: 0,
      elapsedSeconds: 95.5,
    });
    expect(record.gatewayErrorRatio.gated).toBe(false);
    expect(record.apiOutage).toEqual({
      unansweredSamples: 1,
      longestUnansweredSeconds: k3sRestartDrill.sampleIntervalSeconds,
      returnedAfterSeconds: 42,
    });
    expect(record.restart).toEqual({
      via: "ssh",
      host: "debian@kore-vps",
      unit: "k3s",
      inPlace: true,
      drained: false,
    });
    expect(record.evidence).toMatch(
      /zero failed requests with no retries over 120 requests/,
    );
    expect(record.evidence).toMatch(/1 unanswered sample/);
  });
});
