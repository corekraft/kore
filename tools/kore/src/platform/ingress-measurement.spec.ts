import { beforeEach, expect, test, vi } from "vitest";
import { fakeRunner } from "./platform-support.js";
import { expectedStatus, options } from "./ingress-measurement.fixtures.js";
import {
  IngressMeasurement,
  ingressRoutes,
  type MeasurementDeps,
} from "./ingress-measurement.js";
import { parsePodMetrics, summarizeSamples } from "./ingress-metrics.js";
import { cpuPerRequest, matchRate } from "./ingress-pacing.js";

// The metrics parser and summary are same-domain units, so they are typed
// stubs here. The real maths runs in integration/platform/ingress-measurement.spec.ts.
vi.mock("./ingress-metrics.js", () => ({
  parsePodMetrics: vi.fn(),
  summarizeSamples: vi.fn(),
}));

// Pacing and cpu-per-request maths is its own unit (ingress-pacing.spec.ts).
vi.mock("./ingress-pacing.js", () => ({
  cpuPerRequest: vi.fn(() => ({})),
  matchRate: vi.fn(),
}));

// The pacer is its own unit (ingress-pacer.spec.ts); paced runs batch by 10.
vi.mock("./ingress-pacer.js", () => ({
  LoadPacer: vi.fn(function (target: number | undefined) {
    return {
      target,
      batchSize: target === undefined ? 50 : 10,
      begin: () => 0,
      end: async () => undefined,
    };
  }),
}));

vi.mock("./ingress-probe.js", () => ({ probeLatency: async () => [] }));

const [GATEWAY_JSON, ZTUNNEL_JSON] = ["gateway-metrics", "ztunnel-metrics"];
const INGRESS_SUMMARY = {
  samples: 2,
  cpuMillicores: { median: 5, max: 6 },
  memoryMiB: { median: 50, max: 51 },
};
const ZTUNNEL_SUMMARY = {
  samples: 2,
  cpuMillicores: { median: 2, max: 3 },
  memoryMiB: { median: 20, max: 21 },
};
const GATEWAY_PATH =
  "/apis/metrics.k8s.io/v1beta1/namespaces/kore-system/pods?labelSelector=gateway.networking.k8s.io%2Fgateway-name%3Dkore-gateway";
const ZTUNNEL_PATH =
  "/apis/metrics.k8s.io/v1beta1/namespaces/istio-system/pods?labelSelector=app.kubernetes.io%2Fname%3Dztunnel";

/** Answers the metrics API read for the Gateway or ztunnel pods. */
const metricsReply = (_command: string, args: readonly string[]) =>
  String(args.at(-1)).includes("istio-system") ? ZTUNNEL_JSON : GATEWAY_JSON;

/** Answers each curl route with its status, once per requested round. */
const loadReply =
  (overrides: Record<string, number> = {}, count = 50) =>
  (_command: string, args: readonly string[]) => {
    const path = /:\d+(\/[^#]*)#/.exec(String(args.at(-1)))?.[1] ?? "";
    return `${overrides[path] ?? expectedStatus[path] ?? 0}\n`.repeat(count);
  };

function measurementWith(loadReplyFn = loadReply(), target?: number) {
  const metrics = fakeRunner(metricsReply);
  const load = fakeRunner(loadReplyFn);
  const deps: MeasurementDeps = {
    sleep: vi.fn<(seconds: number) => Promise<void>>(async () => undefined),
    loadAverage: vi.fn(() => 1),
    now: vi.fn(() => 0),
  };
  const measurement = new IngressMeasurement(
    metrics.runner,
    load.runner,
    options(target === undefined ? {} : { targetRequestsPerSecond: target }),
    deps,
  );
  return { measurement, metrics, load, deps };
}

beforeEach(function stubMetricsUnits() {
  vi.mocked(matchRate).mockReset();
  vi.mocked(parsePodMetrics).mockImplementation((json) =>
    json === GATEWAY_JSON
      ? [{ name: "gw", cpuMillicores: 5, memoryMiB: 50 }]
      : [{ name: "zt", cpuMillicores: 2, memoryMiB: 20 }],
  );
  vi.mocked(summarizeSamples).mockImplementation((samples) =>
    samples[0]?.[0]?.name === "gw" ? INGRESS_SUMMARY : ZTUNNEL_SUMMARY,
  );
});

test("refuses to measure while the host load average is at or above the limit, and calls nothing", async () => {
  const { measurement, metrics, load, deps } = measurementWith();
  vi.mocked(deps.loadAverage).mockReturnValue(10);

  await expect(measurement.measure()).rejects.toThrow(
    "host 1-minute load average 10 is not below 10",
  );
  expect(metrics.run).not.toHaveBeenCalled();
  expect(load.run).not.toHaveBeenCalled();
  expect(deps.sleep).not.toHaveBeenCalled();
});

test("settles for the configured time, then waits one interval before each sample", async () => {
  const { measurement, deps } = measurementWith();

  await measurement.measure();

  expect(vi.mocked(deps.sleep).mock.calls.map(([s]) => s)).toEqual([
    60, 20, 20,
  ]);
});

test("reads the Gateway pods, then ztunnel, through the metrics API with read-only kubectl calls", async () => {
  const { measurement, metrics } = measurementWith();

  await measurement.measure();

  expect(metrics.run.mock.calls.map(([, args]) => args)).toEqual([
    ["--context", "k3d-kore-local", "get", "--raw", GATEWAY_PATH],
    ["--context", "k3d-kore-local", "get", "--raw", ZTUNNEL_PATH],
    ["--context", "k3d-kore-local", "get", "--raw", GATEWAY_PATH],
    ["--context", "k3d-kore-local", "get", "--raw", ZTUNNEL_PATH],
  ]);
});

test("the request load is the fixed curl call for each route, with the local CA and no insecure flag", async () => {
  const { measurement, load } = measurementWith();

  await measurement.measure();

  expect(matchRate).not.toHaveBeenCalled();
  expect(load.run.mock.calls[0]).toEqual([
    "curl",
    [
      "--silent",
      "--show-error",
      "--output",
      "/dev/null",
      "--write-out",
      "%{http_code}\\n",
      "--connect-timeout",
      "5",
      "--max-time",
      "60",
      "--cacert",
      "/ca/rootCA.pem",
      "--resolve",
      "kore.local:8443:127.0.0.1",
      "--parallel",
      "--parallel-max",
      "4",
      "https://kore.local:8443/livez#[1-50]",
    ],
    { capture: true },
  ]);
  for (const [command, args] of load.run.mock.calls) {
    expect(command).toBe("curl");
    expect(args).not.toContain("--insecure");
  }
});

test("the Gateway pods and the ztunnel pods are summarised in their own columns", async () => {
  const { measurement } = measurementWith();

  const result = await measurement.measure();

  expect(vi.mocked(summarizeSamples)).toHaveBeenCalledTimes(2);
  expect(result.summary).toEqual({
    ingress: INGRESS_SUMMARY,
    ztunnel: ZTUNNEL_SUMMARY,
  });
  expect(result.pods).toEqual({ ingress: ["gw"], ztunnel: ["zt"] });
});

test("records the load average at each sample and its rise during the run", async () => {
  const { measurement, deps } = measurementWith();
  vi.mocked(deps.loadAverage)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(2)
    .mockReturnValueOnce(3);

  const result = await measurement.measure();

  // The first reading is the start check; each sample reads it again.
  expect(result.samples.map((sample) => sample.loadAverage)).toEqual([2, 3]);
  expect(result.loadAverage).toEqual({ start: 1, max: 3 });
});

test("records elapsed time and a request rate that is the completed requests over that time", async () => {
  const { measurement, deps } = measurementWith();
  vi.mocked(deps.now).mockReturnValueOnce(0).mockReturnValue(40_000);

  const { load } = await measurement.measure();

  expect(load.elapsedSeconds).toBe(40);
  expect(load.requests).toBeGreaterThan(0);
  expect(load.requests % 50).toBe(0);
  expect(load.requestsPerSecond).toBe(
    Math.round((load.requests / 40) * 10) / 10,
  );
  // Unpaced, the clock is read only at the start and the end of the run.
  expect(deps.now).toHaveBeenCalledTimes(2);
});

test.each([
  ["/api", 502, 200],
  ["/api/protected", 200, 403],
])(
  "route %s answering %s instead of %s fails the measurement and names the route",
  async (path, got, expected) => {
    const { measurement } = measurementWith(loadReply({ [path]: got }));

    await expect(measurement.measure()).rejects.toThrow(
      `route ${path} answered ${got} for 50 of 50 requests, expected ${expected}`,
    );
  },
);

test("a round that completes fewer requests than were sent fails the measurement", async () => {
  const { measurement } = measurementWith(loadReply({}, 10));

  await expect(measurement.measure()).rejects.toThrow(
    "route /livez completed 10 of 50 requests",
  );
});

test("a pod with no metrics fails naming the selector and the namespace", async () => {
  const { measurement } = measurementWith();
  vi.mocked(parsePodMetrics).mockReturnValue([]);

  await expect(measurement.measure()).rejects.toThrow(
    "no pod metrics for gateway.networking.k8s.io/gateway-name=kore-gateway in kore-system",
  );
});

test("a failing request load fails the measurement with an actionable message", async () => {
  const { measurement, load } = measurementWith();
  vi.mocked(load.run).mockRejectedValue(
    new Error("curl failed (7): connection refused"),
  );

  await expect(measurement.measure()).rejects.toThrow(
    "the request load to https://kore.local:8443 failed: curl failed (7): connection refused; check that kore local up converged and the k3d load balancer maps port 8443",
  );
});

test("the result states the fixed method so it can be repeated exactly", async () => {
  const { measurement } = measurementWith();

  const { method } = await measurement.measure();

  expect(method).toEqual({
    gateway: "kore-system/kore-gateway",
    routes: ingressRoutes.map((route) => route.path),
    requestsPerRoute: 50,
    concurrency: 4,
    settleSeconds: 60,
    sampleCount: 2,
    sampleIntervalSeconds: 20,
  });
});

test("with a target each curl call is one paced batch and the rate is checked against it", async () => {
  const check = { status: "rate_mismatch" } as ReturnType<typeof matchRate>;
  vi.mocked(matchRate).mockReturnValue(check);
  const { measurement, load } = measurementWith(loadReply({}, 10), 40);

  const result = await measurement.measure();

  expect(load.run.mock.calls[0]?.[1].at(-1)).toBe(
    "https://kore.local:8443/livez#[1-10]",
  );
  expect(result.method).toMatchObject({
    targetRequestsPerSecond: 40,
    batchSize: 10,
  });
  expect(matchRate).toHaveBeenCalledWith(40, result.load.requestsPerSecond);
  expect(result.rate).toBe(check);
});

test("cpu per request is reported from the median millicores and the achieved rate", async () => {
  vi.mocked(cpuPerRequest).mockReturnValue({ ingress: 0.1, ztunnel: 0.04 });
  const { measurement } = measurementWith();

  const result = await measurement.measure();

  expect(cpuPerRequest).toHaveBeenCalledWith(
    { ingress: 5, ztunnel: 2 },
    result.load.requestsPerSecond,
  );
  expect(result.cpuPerRequest).toEqual({ ingress: 0.1, ztunnel: 0.04 });
});
