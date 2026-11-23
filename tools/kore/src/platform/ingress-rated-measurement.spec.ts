import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import {
  IngressMeasurement,
  type Measurement,
  type MeasurementDeps,
} from "./ingress-measurement.js";
import type { HostReader, HostSnapshot } from "./ingress-host.js";
import { PacedRunner } from "./ingress-paced-runner.js";
import { cpuPerRequest, matchRate, pacingPlan } from "./ingress-pacing.js";
import {
  RatedMeasurement,
  type RatedOptions,
} from "./ingress-rated-measurement.js";

vi.mock("./ingress-measurement.js", () => ({ IngressMeasurement: vi.fn() }));
vi.mock("./ingress-paced-runner.js", () => ({ PacedRunner: vi.fn() }));
vi.mock("./ingress-pacing.js", () => ({
  cpuPerRequest: vi.fn(),
  matchRate: vi.fn(),
  pacingPlan: vi.fn(),
}));

const BASE = {
  method: { requestsPerRoute: 200, concurrency: 4 },
  load: { requests: 800, elapsedSeconds: 20, requestsPerSecond: 40 },
  summary: {
    ingress: { cpuMillicores: { median: 8 } },
    ztunnel: { cpuMillicores: { median: 2 } },
  },
} as unknown as Measurement;
const CHECK = { status: "rate_mismatch" } as ReturnType<typeof matchRate>;
const PER_REQUEST = { ingress: 0.2, ztunnel: 0.05 };
const options = { requestsPerRoute: 200 } as RatedOptions;
const metrics = { run: vi.fn() } satisfies Runner;
const load = { run: vi.fn() } satisfies Runner;
const deps = {} as MeasurementDeps;
const measure = vi.fn<() => Promise<Measurement>>();

beforeEach(() => {
  vi.clearAllMocks();
  measure.mockResolvedValue(BASE);
  vi.mocked(IngressMeasurement).mockImplementation(function () {
    return { measure } as unknown as IngressMeasurement;
  });
  vi.mocked(PacedRunner).mockImplementation(function () {
    return {} as PacedRunner;
  });
  vi.mocked(pacingPlan).mockReturnValue({ batchSize: 10, batchSeconds: 0.25 });
  vi.mocked(matchRate).mockReturnValue(CHECK);
  vi.mocked(cpuPerRequest).mockReturnValue(PER_REQUEST);
});

test("without a target the measurement is built exactly as given: same options, same runner, no pacing", async () => {
  const result = await new RatedMeasurement(
    metrics,
    load,
    options,
    deps,
  ).measure();

  expect(IngressMeasurement).toHaveBeenCalledExactlyOnceWith(
    metrics,
    load,
    options,
    deps,
  );
  expect(PacedRunner).not.toHaveBeenCalled();
  expect(pacingPlan).not.toHaveBeenCalled();
  expect(matchRate).not.toHaveBeenCalled();
  expect(result.rate).toBeUndefined();
  expect(result.method).toBe(BASE.method);
});

test("with a target the load runs in paced batches: batch-sized options and a paced load runner", async () => {
  const paced = { ...options, targetRequestsPerSecond: 40 };

  await new RatedMeasurement(metrics, load, paced, deps).measure();

  expect(pacingPlan).toHaveBeenCalledWith(40, 200);
  expect(PacedRunner).toHaveBeenCalledWith(load, 0.25, deps);
  const [runner, loadRunner, built] =
    vi.mocked(IngressMeasurement).mock.calls[0] ?? [];
  expect(runner).toBe(metrics);
  expect(loadRunner).toBe(vi.mocked(PacedRunner).mock.results[0]?.value);
  expect(built).toEqual({ ...paced, requestsPerRoute: 10 });
});

test("a paced result names the target and the batch, and carries the rate check, mismatch included", async () => {
  const result = await new RatedMeasurement(
    metrics,
    load,
    { ...options, targetRequestsPerSecond: 40 },
    deps,
  ).measure();

  expect(matchRate).toHaveBeenCalledWith(40, 40);
  expect(result.rate).toBe(CHECK);
  expect(result.method).toEqual({
    ...BASE.method,
    targetRequestsPerSecond: 40,
    batchSize: 10,
  });
});

test("cpu per request comes from the median millicores and the achieved rate, paced or not", async () => {
  const result = await new RatedMeasurement(
    metrics,
    load,
    options,
    deps,
  ).measure();

  expect(cpuPerRequest).toHaveBeenCalledWith({ ingress: 8, ztunnel: 2 }, 40);
  expect(result.cpuPerRequest).toBe(PER_REQUEST);
  expect(result.load).toBe(BASE.load);
});

test("an invalid target is rejected by the plan before anything runs", async () => {
  vi.mocked(pacingPlan).mockImplementation(() => {
    throw new Error("KORE_INGRESS_TARGET_RPS must be a positive number");
  });

  await expect(
    new RatedMeasurement(
      metrics,
      load,
      { ...options, targetRequestsPerSecond: 0 },
      deps,
    ).measure(),
  ).rejects.toThrow("KORE_INGRESS_TARGET_RPS");
  expect(measure).not.toHaveBeenCalled();
});

const snapshot = (oneMinute: number, count: number | null): HostSnapshot => ({
  load: { oneMinute, fiveMinute: 2, fifteenMinute: 3 },
  swapUsedMiB: 100,
  vmFreeMiB: 5000,
  agentPanes:
    count === null
      ? { count, source: "hc ls", missing: "spawn hc ENOENT" }
      : { count, source: "hc ls" },
});

function hostReading(
  order: string[],
  before: HostSnapshot,
  after: HostSnapshot,
) {
  const read = vi
    .fn<HostReader["read"]>()
    .mockImplementationOnce(async () => {
      order.push("before");
      return before;
    })
    .mockImplementationOnce(async () => {
      order.push("after");
      return after;
    });
  measure.mockImplementation(async () => {
    order.push("measure");
    return BASE;
  });
  return { read } satisfies HostReader;
}

test.each([
  ["closed loop", undefined],
  ["paced", 40],
])(
  "a %s result records the host before the run and after it",
  async (_name, target) => {
    const order: string[] = [];
    const before = snapshot(1, 4);
    const after = snapshot(6, 9);
    const host = hostReading(order, before, after);

    const result = await new RatedMeasurement(
      metrics,
      load,
      target === undefined
        ? options
        : { ...options, targetRequestsPerSecond: target },
      deps,
      host,
    ).measure();

    expect(result.host).toEqual({ before, after });
    expect(order).toEqual(["before", "measure", "after"]);
  },
);

test("a missing agent pane source stays named in the recorded host, not zero", async () => {
  const missing = snapshot(1, null);
  const host = hostReading([], missing, missing);

  const result = await new RatedMeasurement(
    metrics,
    load,
    options,
    deps,
    host,
  ).measure();

  expect(result.host?.before.agentPanes).toEqual({
    count: null,
    source: "hc ls",
    missing: "spawn hc ENOENT",
  });
});

test("carries no host field when no host reader is given", async () => {
  expect(
    await new RatedMeasurement(metrics, load, options, deps).measure(),
  ).not.toHaveProperty("host");
});

test("a refused or failed measurement is not followed by a second host read", async () => {
  const order: string[] = [];
  const host = hostReading(order, snapshot(1, 4), snapshot(6, 9));
  measure.mockRejectedValue(
    new Error("host 1-minute load average 12 is not below 10"),
  );

  await expect(
    new RatedMeasurement(metrics, load, options, deps, host).measure(),
  ).rejects.toThrow("host 1-minute load average 12 is not below 10");
  expect(order).toEqual(["before"]);
});

test("an unreadable host stops the run before any load is sent", async () => {
  const read = vi
    .fn<HostReader["read"]>()
    .mockRejectedValue(new Error("reading the macOS swap usage failed: boom"));

  await expect(
    new RatedMeasurement(metrics, load, options, deps, { read }).measure(),
  ).rejects.toThrow("reading the macOS swap usage failed: boom");
  expect(measure).not.toHaveBeenCalled();
});
