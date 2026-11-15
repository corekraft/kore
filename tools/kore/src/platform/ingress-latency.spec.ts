import { beforeEach, expect, test, vi } from "vitest";
import { fakeRunner } from "./platform-support.js";
import { options } from "./ingress-measurement.fixtures.js";
import {
  IngressMeasurement,
  type MeasurementDeps,
  type MeasurementOptions,
} from "./ingress-measurement.js";
import { probeLatency } from "./ingress-probe.js";
import {
  parsePodMetrics,
  summarizeLatency,
  summarizeSamples,
} from "./ingress-metrics.js";

// Same-domain units are typed stubs; the real percentile maths is covered in
// ingress-metrics.spec.ts.
vi.mock("./ingress-metrics.js", () => ({
  parsePodMetrics: vi.fn(),
  summarizeSamples: vi.fn(),
  summarizeLatency: vi.fn(),
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

vi.mock("./ingress-probe.js", () => ({ probeLatency: vi.fn() }));
vi.mock("./ingress-pacing.js", () => ({
  cpuPerRequest: vi.fn(() => ({})),
  matchRate: vi.fn(),
}));

const POD = { name: "gw", cpuMillicores: 5, memoryMiB: 50 };
const SUMMARY = {
  samples: 2,
  cpuMillicores: { median: 5, max: 6 },
  memoryMiB: { median: 50, max: 51 },
};
const LATENCY = { requests: 3, p50Ms: 10, p95Ms: 30, maxMs: 30 };

function measurementWith(overrides: Partial<MeasurementOptions> = {}) {
  const metrics = fakeRunner(() => "metrics");
  const load = fakeRunner((_command, args) =>
    `${/\/api\/protected#/.test(String(args.at(-1))) ? 403 : 200}\n`.repeat(50),
  );
  const deps: MeasurementDeps = {
    sleep: vi.fn<(seconds: number) => Promise<void>>(async () => undefined),
    loadAverage: vi.fn(() => 1),
    now: vi.fn(() => 0),
  };
  const measurement = new IngressMeasurement(
    metrics.runner,
    load.runner,
    options(overrides),
    deps,
  );
  return { measurement, load };
}

beforeEach(() => {
  vi.mocked(parsePodMetrics).mockReturnValue([POD]);
  vi.mocked(summarizeSamples).mockReturnValue(SUMMARY);
  vi.mocked(summarizeLatency).mockReturnValue(LATENCY);
  vi.mocked(probeLatency).mockResolvedValue([]);
});

test("when the probe returns no times the measurement reports no latency", async () => {
  const { measurement } = measurementWith();

  const result = await measurement.measure();

  expect(result.latency).toBeUndefined();
  expect(summarizeLatency).not.toHaveBeenCalled();
});

test("each sample probes through the load runner with the options", async () => {
  const { measurement, load } = measurementWith({ latencyProbesPerRoute: 3 });

  await measurement.measure();

  expect(vi.mocked(probeLatency)).toHaveBeenCalledTimes(2);
  expect(vi.mocked(probeLatency).mock.calls[0]?.[0]).toBe(load.runner);
  expect(vi.mocked(probeLatency).mock.calls[0]?.[1]).toMatchObject({
    latencyProbesPerRoute: 3,
  });
});

test("reports the summary of every probe time across the samples", async () => {
  vi.mocked(probeLatency).mockResolvedValue([10, 20, 30]);
  const { measurement } = measurementWith({ latencyProbesPerRoute: 3 });

  const result = await measurement.measure();

  expect(result.latency).toEqual(LATENCY);
  expect(vi.mocked(summarizeLatency).mock.calls).toEqual([
    [[10, 20, 30, 10, 20, 30]],
  ]);
});
