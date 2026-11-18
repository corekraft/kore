import { beforeEach, expect, test, vi } from "vitest";
import { fakeRunner } from "./platform-support.js";
import {
  IngressMeasurement,
  ingressRoutes,
  type MeasurementDeps,
  type MeasurementOptions,
} from "./ingress-measurement.js";
import type { HostReader, HostSnapshot } from "./ingress-host.js";
import { parsePodMetrics, summarizeSamples } from "./ingress-metrics.js";

// The metrics parser and summary are same-domain units, so they are typed
// stubs here. The real maths runs in integration/platform/ingress-measurement.spec.ts.
vi.mock("./ingress-metrics.js", () => ({
  parsePodMetrics: vi.fn(),
  summarizeSamples: vi.fn(),
}));

const GATEWAY_JSON = "gateway-metrics";
const ZTUNNEL_JSON = "ztunnel-metrics";
const GATEWAY_POD = { name: "gw", cpuMillicores: 5, memoryMiB: 50 };
const ZTUNNEL_POD = { name: "zt", cpuMillicores: 2, memoryMiB: 20 };
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

const statusFor: Record<string, number> = {
  "/livez": 200,
  "/readyz": 200,
  "/api": 200,
  "/api/protected": 403,
};

const options: MeasurementOptions = {
  kubeContext: "k3d-kore-local",
  gateway: { namespace: "kore-system", name: "kore-gateway" },
  hostname: "kore.local",
  port: 8443,
  caRoot: "/ca",
  settleSeconds: 60,
  sampleCount: 2,
  sampleIntervalSeconds: 20,
  requestsPerRoute: 50,
  concurrency: 4,
  maxLoadAverage: 10,
};

/** Answers the metrics API read for the Gateway or ztunnel pods. */
const metricsReply = (_command: string, args: readonly string[]) =>
  String(args.at(-1)).includes("istio-system") ? ZTUNNEL_JSON : GATEWAY_JSON;

/** Answers each curl route with its status, once per requested round. */
const loadReply =
  (overrides: Record<string, number> = {}, count = 50) =>
  (_command: string, args: readonly string[]) => {
    const path = /:\d+(\/[^#]*)#/.exec(String(args.at(-1)))?.[1] ?? "";
    return `${overrides[path] ?? statusFor[path] ?? 0}\n`.repeat(count);
  };

const BEFORE: HostSnapshot = {
  load: { oneMinute: 1, fiveMinute: 2, fifteenMinute: 3 },
  swapUsedMiB: 100,
  vmFreeMiB: 5000,
  agentPanes: { count: 4, source: "herdr agent list" },
};
const AFTER: HostSnapshot = {
  load: { oneMinute: 6, fiveMinute: 4, fifteenMinute: 3.5 },
  swapUsedMiB: 300,
  vmFreeMiB: 4000,
  agentPanes: { count: 9, source: "herdr agent list" },
};

function measurementWith(loadReplyFn = loadReply(), host?: HostReader) {
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
    options,
    deps,
    host,
  );
  return { measurement, metrics, load, deps };
}

beforeEach(function stubMetricsUnits() {
  vi.mocked(parsePodMetrics).mockImplementation((json) =>
    json === GATEWAY_JSON ? [GATEWAY_POD] : [ZTUNNEL_POD],
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
});

test("a route answering the wrong status fails the measurement and names the route", async () => {
  const { measurement } = measurementWith(loadReply({ "/api": 502 }));

  await expect(measurement.measure()).rejects.toThrow(
    "route /api answered 502 for 50 of 50 requests, expected 200",
  );
});

test("a protected route that stops denying fails the measurement", async () => {
  const { measurement } = measurementWith(loadReply({ "/api/protected": 200 }));

  await expect(measurement.measure()).rejects.toThrow(
    "route /api/protected answered 200 for 50 of 50 requests, expected 403",
  );
});

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

function hostReader(...snapshots: HostSnapshot[]) {
  const read = vi
    .fn<HostReader["read"]>()
    .mockResolvedValueOnce(snapshots[0] as HostSnapshot)
    .mockResolvedValueOnce(snapshots[1] as HostSnapshot);
  return { read } satisfies HostReader;
}

test("records the host's load, swap, free VM memory and agent panes before the settle and after the load", async () => {
  const order: string[] = [];
  const host = hostReader(BEFORE, AFTER);
  host.read
    .mockReset()
    .mockImplementationOnce(async () => {
      order.push("before");
      return BEFORE;
    })
    .mockImplementationOnce(async () => {
      order.push("after");
      return AFTER;
    });
  const { measurement, deps } = measurementWith(loadReply(), host);
  vi.mocked(deps.sleep).mockImplementation(async () => {
    order.push("sleep");
  });

  const result = await measurement.measure();

  expect(result.host).toEqual({ before: BEFORE, after: AFTER });
  expect(order).toEqual(["before", "sleep", "sleep", "sleep", "after"]);
});

test("records a missing agent pane source by name and not as zero panes", async () => {
  const missing: HostSnapshot = {
    ...BEFORE,
    agentPanes: {
      count: null,
      source: "herdr agent list",
      missing: "spawn herdr ENOENT",
    },
  };
  const { measurement } = measurementWith(
    loadReply(),
    hostReader(missing, missing),
  );

  const result = await measurement.measure();

  expect(result.host?.before.agentPanes).toEqual({
    count: null,
    source: "herdr agent list",
    missing: "spawn herdr ENOENT",
  });
});

test("names the host load as the reason for a refusal and reads no host conditions", async () => {
  const host = hostReader(BEFORE, AFTER);
  const { measurement, deps } = measurementWith(loadReply(), host);
  vi.mocked(deps.loadAverage).mockReturnValue(12.5);

  await expect(measurement.measure()).rejects.toThrow(
    "host 1-minute load average 12.5 is not below 10; wait for the host to quiet down and rerun",
  );
  expect(host.read).not.toHaveBeenCalled();
});

test("carries no host field when no host reader is given", async () => {
  const { measurement } = measurementWith();

  expect(await measurement.measure()).not.toHaveProperty("host");
});
