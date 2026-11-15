import { beforeEach, expect, test, vi } from "vitest";
import { fakeRunner } from "./platform-support.js";
import {
  IngressMeasurement,
  type MeasurementDeps,
  type MeasurementOptions,
} from "./ingress-measurement.js";
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

const POD = { name: "gw", cpuMillicores: 5, memoryMiB: 50 };
const SUMMARY = {
  samples: 2,
  cpuMillicores: { median: 5, max: 6 },
  memoryMiB: { median: 50, max: 51 },
};
const LATENCY = { requests: 3, p50Ms: 10, p95Ms: 30, maxMs: 30 };

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

const isTimed = (args: readonly string[]): boolean =>
  args.includes("%{time_total}\\n");

function measurementWith(
  overrides: Partial<MeasurementOptions> = {},
  timed = "0.010\n0.020\n0.030\n",
) {
  const metrics = fakeRunner(() => "metrics");
  const load = fakeRunner((_command, args) =>
    isTimed(args)
      ? timed
      : `${/\/api\/protected#/.test(String(args.at(-1))) ? 403 : 200}\n`.repeat(
          50,
        ),
  );
  const deps: MeasurementDeps = {
    sleep: vi.fn<(seconds: number) => Promise<void>>(async () => undefined),
    loadAverage: vi.fn(() => 1),
    now: vi.fn(() => 0),
  };
  const measurement = new IngressMeasurement(
    metrics.runner,
    load.runner,
    { ...options, ...overrides },
    deps,
  );
  return { measurement, load };
}

beforeEach(() => {
  vi.mocked(parsePodMetrics).mockReturnValue([POD]);
  vi.mocked(summarizeSamples).mockReturnValue(SUMMARY);
  vi.mocked(summarizeLatency).mockReturnValue(LATENCY);
});

test("without latencyProbesPerRoute the measurement sends no timing request and reports no latency", async () => {
  const { measurement, load } = measurementWith();

  const result = await measurement.measure();

  expect(load.run.mock.calls.filter(([, args]) => isTimed(args))).toHaveLength(
    0,
  );
  expect(result.latency).toBeUndefined();
  expect(summarizeLatency).not.toHaveBeenCalled();
});

test("with latencyProbesPerRoute each sample times that many sequential GETs per route, with the local CA", async () => {
  const { measurement, load } = measurementWith({ latencyProbesPerRoute: 3 });

  await measurement.measure();

  const timed = load.run.mock.calls.filter(([, args]) => isTimed(args));
  expect(timed).toHaveLength(8);
  expect(timed[0]).toEqual([
    "curl",
    [
      "--silent",
      "--show-error",
      "--output",
      "/dev/null",
      "--write-out",
      "%{time_total}\\n",
      "--connect-timeout",
      "5",
      "--max-time",
      "60",
      "--cacert",
      "/ca/rootCA.pem",
      "--resolve",
      "kore.local:8443:127.0.0.1",
      "https://kore.local:8443/livez#[1-3]",
    ],
    { capture: true },
  ]);
  for (const [, args] of timed) {
    expect(args).not.toContain("--insecure");
    expect(args).not.toContain("--parallel");
  }
});

test("reports the summary of every probe time, converted from seconds to milliseconds", async () => {
  const { measurement } = measurementWith({ latencyProbesPerRoute: 3 });

  const result = await measurement.measure();

  expect(result.latency).toEqual(LATENCY);
  expect(vi.mocked(summarizeLatency).mock.calls).toEqual([
    [Array.from({ length: 8 }, () => [10, 20, 30]).flat()],
  ]);
});

test("an unreadable probe time fails naming the route and the fix", async () => {
  const { measurement } = measurementWith(
    { latencyProbesPerRoute: 3 },
    "0.010\nnot-a-time\n",
  );

  await expect(measurement.measure()).rejects.toThrow(
    "latency probe of /livez returned an unreadable time 'not-a-time'; check that curl reached https://kore.local:8443",
  );
});
