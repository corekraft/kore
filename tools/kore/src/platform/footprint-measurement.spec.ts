import { beforeEach, expect, test, vi } from "vitest";
import { fakeRunner } from "./platform-support.js";
import {
  FootprintMeasurement,
  footprintMeasurementDefaults,
  type FootprintDeps,
  type FootprintOptions,
} from "./footprint-measurement.js";
import {
  parseContainerStats,
  parseSwapUsedMiB,
  parseVmMemoryMiB,
} from "./footprint-parse.js";
import { summarizeFootprint } from "./footprint-summary.js";

// The parsers and the arithmetic are same-domain units, so they are stubs here.
// Their own specs prove what they read and compute.
vi.mock("./footprint-parse.js", () => ({
  parseContainerStats: vi.fn(),
  parseSwapUsedMiB: vi.fn(),
  parseVmMemoryMiB: vi.fn(),
}));
vi.mock("./footprint-summary.js", () => ({ summarizeFootprint: vi.fn() }));

const SUMMARY = {
  summary: {
    cpuMillicores: { median: 300, max: 350 },
    memoryMiB: { median: 3000, max: 3500 },
    swapMiB: { median: 100, max: 100 },
    loadAverage: { median: 2, max: 2 },
  },
  headroomPercent: { atMedian: 70, atPeak: 65 },
};

const options: FootprintOptions = {
  serverContainer: "k3d-kore-local-server-0",
  settleSeconds: 120,
  sampleCount: 2,
  sampleIntervalSeconds: 20,
  maxLoadAverage: 10,
};

const reply = (command: string, args: readonly string[]): string =>
  command === "sysctl" ? "SWAP" : args[0] === "info" ? "VM" : "STATS";

function measurementWith(load = 1) {
  const { runner, run } = fakeRunner(reply);
  const deps: FootprintDeps = {
    sleep: vi.fn<(seconds: number) => Promise<void>>(async () => undefined),
    loadAverage: vi.fn(() => load),
    now: vi.fn(() => 0),
  };
  return {
    run,
    deps,
    measurement: new FootprintMeasurement(runner, options, deps),
  };
}

beforeEach(function stubParsers() {
  vi.mocked(parseVmMemoryMiB).mockReturnValue(10000);
  vi.mocked(parseSwapUsedMiB).mockReturnValue(100);
  vi.mocked(parseContainerStats).mockReturnValue({
    cpuMillicores: 300,
    memoryMiB: 3000,
  });
  vi.mocked(summarizeFootprint).mockReturnValue(SUMMARY);
});

test("refuses to start at or above the load ceiling, naming both numbers, and reads nothing", async () => {
  const { measurement, run, deps } = measurementWith(10);

  await expect(measurement.measure()).rejects.toThrow(
    "host 1-minute load average 10 is not below 10; wait for the host to quiet down and rerun",
  );
  expect(run).not.toHaveBeenCalled();
  expect(deps.sleep).not.toHaveBeenCalled();
});

test("settles, then waits one interval before each sample", async () => {
  const { measurement, deps } = measurementWith();

  await measurement.measure();

  expect(vi.mocked(deps.sleep).mock.calls.map(([s]) => s)).toEqual([
    120, 20, 20,
  ]);
});

test("reads the VM once, then stats and swap per sample, with read-only calls", async () => {
  const { measurement, run } = measurementWith();

  await measurement.measure();

  expect(run.mock.calls.map(([command, args]) => [command, ...args])).toEqual([
    ["docker", "info", "--format", "{{.MemTotal}}"],
    [
      "docker",
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
      "k3d-kore-local-server-0",
    ],
    ["sysctl", "vm.swapusage"],
    [
      "docker",
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
      "k3d-kore-local-server-0",
    ],
    ["sysctl", "vm.swapusage"],
  ]);
});

test("a clean run returns every sample with the summary and headroom for the VM size", async () => {
  const { measurement } = measurementWith();

  const result = await measurement.measure();

  const sample = {
    cpuMillicores: 300,
    memoryMiB: 3000,
    swapMiB: 100,
    loadAverage: 1,
  };
  expect(result.samples).toEqual([sample, sample]);
  expect(summarizeFootprint).toHaveBeenCalledWith([sample, sample], 10000);
  expect(result).toMatchObject({
    vmMemoryMiB: 10000,
    summary: SUMMARY.summary,
    headroomPercent: SUMMARY.headroomPercent,
    loadAverage: { start: 1, max: 1 },
    overCeiling: [],
  });
});

test("reports a mid-run load rise beside the results instead of hiding it", async () => {
  const { measurement, deps } = measurementWith();
  vi.mocked(deps.loadAverage)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(4)
    .mockReturnValueOnce(12.5);

  const result = await measurement.measure();

  expect(result.loadAverage).toEqual({ start: 1, max: 12.5 });
  expect(result.overCeiling).toEqual([12.5]);
});

test("records the method values and the elapsed seconds on the monotonic clock", async () => {
  const { measurement, deps } = measurementWith();
  vi.mocked(deps.now).mockReturnValueOnce(1000).mockReturnValueOnce(61_000);

  const result = await measurement.measure();

  expect(result.method).toEqual({
    serverContainer: "k3d-kore-local-server-0",
    settleSeconds: 120,
    sampleCount: 2,
    sampleIntervalSeconds: 20,
    maxLoadAverage: 10,
  });
  expect(result.elapsedSeconds).toBe(60);
});

test("fails with the cause named when a read fails", async () => {
  const { measurement, run } = measurementWith();
  run.mockRejectedValueOnce(new Error("Cannot connect to the Docker daemon"));

  await expect(measurement.measure()).rejects.toThrow(
    "reading the Docker VM memory failed: Cannot connect to the Docker daemon; check that Docker is running",
  );
});

test("fails with the cause named when a read is unparseable", async () => {
  const { measurement } = measurementWith();
  vi.mocked(parseSwapUsedMiB).mockImplementation(() => {
    throw new Error("unreadable swap usage report");
  });

  await expect(measurement.measure()).rejects.toThrow(
    "reading the macOS swap usage failed: unreadable swap usage report; this measurement needs macOS",
  );
});

test("the fixed method defaults are the values every horizon runs", () => {
  expect(footprintMeasurementDefaults).toEqual({
    settleSeconds: 120,
    sampleCount: 12,
    sampleIntervalSeconds: 20,
    maxLoadAverage: 10,
  });
});
