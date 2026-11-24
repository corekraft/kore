import { describe, expect, test } from "vitest";
import {
  belowMinimum,
  deploymentOf,
  drillRecordOf,
  evidenceOf,
  settled,
  type Deployment,
  type RolloutRecord,
} from "./golden-path-rollout-support.js";

const steady: Deployment = {
  name: "golden-path-example-bff",
  desired: 2,
  generation: 4,
  observed: 4,
  replicas: 2,
  updated: 2,
  ready: 2,
};

describe("reading a Deployment", () => {
  test("reads the name, the settled replica count and the rollout status", () => {
    expect(
      deploymentOf({
        metadata: { name: "golden-path-example-bff", generation: 4 },
        spec: { replicas: 2 },
        status: {
          observedGeneration: 4,
          replicas: 2,
          updatedReplicas: 2,
          readyReplicas: 2,
        },
      }),
    ).toEqual(steady);
  });

  test("takes one replica when spec.replicas is absent, as the API server defaults it", () => {
    expect(
      deploymentOf({ metadata: { name: "one" }, status: {} }).desired,
    ).toBe(1);
  });

  test("refuses a document with no name, rather than rolling an unnamed Deployment", () => {
    expect(() => deploymentOf({ spec: { replicas: 2 } })).toThrow(
      /no metadata.name/,
    );
  });
});

describe("a rollout is settled", () => {
  test("only once every replica is updated, running and ready at the settled count", () => {
    expect(settled(steady)).toBe(true);
  });

  test("not before the controller has seen the restart, so the old, still-ready Pods do not pass for a finished rollout", () => {
    expect(settled({ ...steady, generation: 5, observed: 4 })).toBe(false);
  });

  test("not while a surge Pod runs above the settled count", () => {
    expect(settled({ ...steady, replicas: 3, ready: 2 })).toBe(false);
  });

  test("not while the replicas are still on the old template", () => {
    expect(settled({ ...steady, updated: 1 })).toBe(false);
  });

  test("not while an updated replica is not yet ready", () => {
    expect(settled({ ...steady, ready: 1 })).toBe(false);
  });
});

describe("the minimum of ready replicas", () => {
  test("is breached by any count below the minimum, at any sample", () => {
    expect(belowMinimum({ ...steady, ready: 1 }, 2)).toBe(true);
    expect(belowMinimum({ ...steady, ready: 0 }, 2)).toBe(true);
  });

  test("is not breached at the minimum itself, or above it", () => {
    expect(belowMinimum({ ...steady, ready: 2 }, 2)).toBe(false);
    expect(belowMinimum({ ...steady, ready: 3 }, 2)).toBe(false);
  });
});

describe("the drill record", () => {
  const record = drillRecordOf({
    requests: 1200,
    rollouts: [],
    elapsedSeconds: 240.4,
    loadAverage: 0.8,
    gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
    host: { before: "before", after: "after" },
  });

  test("holds the probe to no retries and no failed request, and says so", () => {
    expect(record.load).toEqual({
      requests: 1200,
      failedRequests: 0,
      retries: 0,
      elapsedSeconds: 240.4,
    });
    expect(record.method.probe).toBe("shared Gateway, curl with no retries");
    expect(record.evidence).toContain("zero failed requests with no retries");
  });

  test("records the gateway error ratio as shadow: shown, never gated", () => {
    expect(record.gatewayErrorRatio).toMatchObject({ value: 0, gated: false });
  });

  test("names the routes and the request count, so a result is compared only with the same method", () => {
    expect(record.method.routes).toEqual(["/", "/healthz", "/api"]);
    expect(record.method.requestsPerRoute).toBe(10);
  });
});

describe("the evidence wording", () => {
  const records: RolloutRecord[] = [
    {
      role: "app",
      deployment: "golden-path-example--local/golden-path-example-bff",
      minimumReady: 2,
      lowestReady: 2,
      samples: 40,
      elapsedSeconds: 61.2,
    },
    {
      role: "gateway-proxy",
      deployment: "kore-system/kore-gateway",
      minimumReady: 2,
      lowestReady: 2,
      samples: 25,
      elapsedSeconds: 38.4,
    },
  ];

  test("states zero failed requests with no retries, the request count and every rollout's floor", () => {
    const text = evidenceOf(1200, records);
    expect(text).toContain("zero failed requests with no retries");
    expect(text).toContain("1200 requests");
    expect(text).toContain("2 rollouts");
    expect(text).toContain(
      "golden-path-example--local/golden-path-example-bff 2/2",
    );
    expect(text).toContain("kore-system/kore-gateway 2/2");
  });

  test("names no rollout when none was observed, so it never claims a rollout it did not see", () => {
    expect(evidenceOf(10, [])).toContain("0 rollouts");
  });
});
