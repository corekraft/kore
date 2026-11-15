import { beforeEach, expect, test, vi } from "vitest";
import { fakeRunner } from "./platform-support.js";
import {
  IngressMeasurement,
  type MeasurementDeps,
  type MeasurementOptions,
} from "./ingress-measurement.js";
import { parsePodMetrics, summarizeSamples } from "./ingress-metrics.js";
import { cpuPerRequest, matchRate, pacingPlan } from "./ingress-pacing.js";

vi.mock("./ingress-metrics.js", () => ({
  parsePodMetrics: vi.fn(),
  summarizeSamples: vi.fn(),
}));
vi.mock("./ingress-probe.js", () => ({
  probeLatency: vi.fn(async () => []),
}));
vi.mock("./ingress-pacing.js", () => ({
  cpuPerRequest: vi.fn(),
  matchRate: vi.fn(),
  pacingPlan: vi.fn(),
}));

const SUMMARY = {
  samples: 2,
  cpuMillicores: { median: 8, max: 9 },
  memoryMiB: { median: 50, max: 51 },
};
const ZTUNNEL_SUMMARY = { ...SUMMARY, cpuMillicores: { median: 2, max: 3 } };
const CHECK = {
  targetRequestsPerSecond: 40,
  achievedRequestsPerSecond: 25,
  tolerancePercent: 10,
  status: "rate_mismatch",
} as const;

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

const status: Record<string, number> = {
  "/livez": 200,
  "/readyz": 200,
  "/api": 200,
  "/api/protected": 403,
};

function measurementWith(
  target: number | undefined,
  nowValues: () => number = () => 0,
) {
  const metrics = fakeRunner((_c, args) =>
    String(args.at(-1)).includes("istio-system") ? "zt" : "gw",
  );
  const load = fakeRunner((_c, args) => {
    const path = /:\d+(\/[^#]*)#/.exec(String(args.at(-1)))?.[1] ?? "";
    const count = Number(/#\[1-(\d+)\]/.exec(String(args.at(-1)))?.[1]);
    return `${status[path] ?? 0}\n`.repeat(count);
  });
  const deps: MeasurementDeps = {
    sleep: vi.fn<(seconds: number) => Promise<void>>(async () => undefined),
    loadAverage: vi.fn(() => 1),
    now: vi.fn(nowValues),
  };
  const measurement = new IngressMeasurement(
    metrics.runner,
    load.runner,
    {
      ...options,
      ...(target === undefined ? {} : { targetRequestsPerSecond: target }),
    },
    deps,
  );
  return { measurement, load, deps };
}

beforeEach(() => {
  vi.mocked(parsePodMetrics).mockImplementation((json) => [
    { name: json, cpuMillicores: 1, memoryMiB: 1 },
  ]);
  vi.mocked(summarizeSamples).mockImplementation((samples) =>
    samples[0]?.[0]?.name === "gw" ? SUMMARY : ZTUNNEL_SUMMARY,
  );
  vi.mocked(pacingPlan).mockReturnValue({ batchSize: 10, batchSeconds: 0.25 });
  vi.mocked(matchRate).mockReturnValue(CHECK);
  vi.mocked(cpuPerRequest).mockReturnValue({ ingress: 0.08, ztunnel: 0.02 });
});

test("without a target the load is the closed loop: no pacing, no rate check", async () => {
  const { measurement, load, deps } = measurementWith(undefined);

  const result = await measurement.measure();

  expect(pacingPlan).not.toHaveBeenCalled();
  expect(matchRate).not.toHaveBeenCalled();
  expect(result.rate).toBeUndefined();
  expect(result.method).not.toHaveProperty("targetRequestsPerSecond");
  expect(vi.mocked(deps.sleep).mock.calls.map(([s]) => s)).toEqual([
    60, 20, 20,
  ]);
  expect(load.run.mock.calls[0]?.[1].at(-1)).toBe(
    "https://kore.local:8443/livez#[1-50]",
  );
});

test("with a target each curl call is one paced batch and the plan comes from the target", async () => {
  const { measurement, load } = measurementWith(40);

  const result = await measurement.measure();

  expect(pacingPlan).toHaveBeenCalledWith(40, 50);
  expect(load.run.mock.calls[0]?.[1].at(-1)).toBe(
    "https://kore.local:8443/livez#[1-10]",
  );
  expect(result.method).toMatchObject({
    targetRequestsPerSecond: 40,
    batchSize: 10,
  });
});

test("a batch that finishes early sleeps out the rest of its slot", async () => {
  let ms = 0;
  const { measurement, deps } = measurementWith(40, () => (ms += 100));

  await measurement.measure();

  const sleeps = vi.mocked(deps.sleep).mock.calls.map(([s]) => s);
  expect(sleeps).toContain(0.15);
});

test("a batch slower than its slot is not followed by any extra sleep", async () => {
  let ms = 0;
  const { measurement, deps } = measurementWith(40, () => (ms += 400));

  await measurement.measure();

  expect(vi.mocked(deps.sleep).mock.calls.map(([s]) => s)).toEqual([
    60, 20, 20,
  ]);
});

test("the achieved rate is checked against the target and a mismatch is reported, not hidden", async () => {
  const { measurement } = measurementWith(40);

  const result = await measurement.measure();

  expect(matchRate).toHaveBeenCalledWith(40, result.load.requestsPerSecond);
  expect(result.rate).toEqual(CHECK);
  expect(result.rate?.status).toBe("rate_mismatch");
});

test("cpu per request is reported for ingress and ztunnel from the achieved rate", async () => {
  const { measurement } = measurementWith(undefined);

  const result = await measurement.measure();

  expect(cpuPerRequest).toHaveBeenCalledWith(
    { ingress: 8, ztunnel: 2 },
    result.load.requestsPerSecond,
  );
  expect(result.cpuPerRequest).toEqual({ ingress: 0.08, ztunnel: 0.02 });
});
