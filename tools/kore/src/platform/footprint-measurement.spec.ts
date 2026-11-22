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
  parseOomKilledPods,
  parseSwapTotalMiB,
  parseSwapUsedMiB,
  parseVmMemoryInUseMiB,
  parseVmMemoryMiB,
} from "./footprint-parse.js";
import { judgeFootprint } from "./footprint-verdict.js";
import { summarizeFootprint } from "./footprint-summary.js";

// The parsers, the arithmetic and the verdict are same-domain units, so they are
// stubs here. Their own specs prove what they read, compute and judge.
vi.mock("./footprint-parse.js", () => ({
  parseContainerStats: vi.fn(),
  parseOomKilledPods: vi.fn(),
  parseSwapTotalMiB: vi.fn(),
  parseSwapUsedMiB: vi.fn(),
  parseVmMemoryInUseMiB: vi.fn(),
  parseVmMemoryMiB: vi.fn(),
}));
vi.mock("./footprint-summary.js", () => ({ summarizeFootprint: vi.fn() }));
vi.mock("./footprint-verdict.js", () => ({ judgeFootprint: vi.fn() }));

const SUMMARY = {
  summary: {
    cpuMillicores: { median: 300, max: 350 },
    memoryMiB: { median: 3000, max: 3500 },
    swapMiB: { median: 100, max: 100 },
    loadAverage: { median: 2, max: 2 },
  },
  headroomPercent: { atMedian: 70, atPeak: 65 },
};

const CLEAN = { breached: false, breaches: [] };

const options: FootprintOptions = {
  serverContainer: "k3d-kore-local-server-0",
  kubeContext: "k3d-kore-local",
  settleSeconds: 120,
  sampleCount: 2,
  sampleIntervalSeconds: 20,
  maxLoadAverage: 10,
};

// One reply per kind of read: the server container's stats are the only
// `docker stats` call that names a container; the VM read names none.
function reply(command: string, args: readonly string[]): string {
  if (command === "kubectl") {
    return "PODS";
  }
  if (command === "sysctl") {
    return "SWAP";
  }
  if (args[0] === "info") {
    return "VM";
  }
  return args.length === 4 ? "ALL" : "STATS";
}

function measurementWith(load = 1) {
  const { runner, run } = fakeRunner(reply);
  const deps: FootprintDeps = {
    sleep: vi.fn<(seconds: number) => Promise<void>>(async () => undefined),
    loadAverage: vi.fn(() => load),
    now: vi.fn(() => 0),
    epochMilliseconds: vi.fn(() => 5000),
    platform: "darwin",
    readFile: vi.fn(async () => "MEMINFO"),
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
  vi.mocked(parseSwapTotalMiB).mockReturnValue(6144);
  vi.mocked(parseContainerStats).mockReturnValue({
    cpuMillicores: 300,
    memoryMiB: 3000,
  });
  vi.mocked(parseVmMemoryInUseMiB).mockReturnValue(4000);
  vi.mocked(parseOomKilledPods).mockReturnValue([]);
  vi.mocked(summarizeFootprint).mockReturnValue(SUMMARY);
  vi.mocked(judgeFootprint).mockReturnValue(CLEAN);
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

test("reads the VM once, then the server's stats, the VM's in-use stats and swap per sample, then the pods, with read-only calls", async () => {
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
    ["docker", "stats", "--no-stream", "--format", "{{json .}}"],
    ["sysctl", "vm.swapusage"],
    [
      "docker",
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
      "k3d-kore-local-server-0",
    ],
    ["docker", "stats", "--no-stream", "--format", "{{json .}}"],
    ["sysctl", "vm.swapusage"],
    [
      "kubectl",
      "--context",
      "k3d-kore-local",
      "get",
      "pods",
      "--all-namespaces",
      "-o",
      "json",
    ],
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
    vmMemoryInUseMiB: [4000, 4000],
    summary: SUMMARY.summary,
    headroomPercent: SUMMARY.headroomPercent,
    loadAverage: { start: 1, max: 1 },
    overCeiling: [],
  });
});

test("judges the peak of the VM's memory in use, the VM size and the OOMKilled pods, and reports the verdict beside the figures", async () => {
  const { measurement } = measurementWith();
  vi.mocked(parseVmMemoryInUseMiB)
    .mockReturnValueOnce(3000)
    .mockReturnValueOnce(3500);
  vi.mocked(parseOomKilledPods).mockReturnValue(["platform/keycloak-0"]);
  const breach = {
    breached: true,
    breaches: [{ rule: "oomkilled" as const, pods: ["platform/keycloak-0"] }],
  };
  vi.mocked(judgeFootprint).mockReturnValue(breach);

  const result = await measurement.measure();

  expect(judgeFootprint).toHaveBeenCalledWith({
    peakInUseMiB: 3500,
    vmMemoryMiB: 10000,
    oomKilledPods: ["platform/keycloak-0"],
  });
  expect(result).toMatchObject({
    verdict: breach,
    summary: SUMMARY.summary,
    headroomPercent: SUMMARY.headroomPercent,
  });
});

test("a small server container does not hide a swamped VM: the verdict is judged on the VM's in-use peak, not the server's memory", async () => {
  const { measurement } = measurementWith();
  vi.mocked(parseContainerStats).mockReturnValue({
    cpuMillicores: 300,
    memoryMiB: 500,
  });
  vi.mocked(parseVmMemoryInUseMiB).mockReturnValue(9000);

  await measurement.measure();

  expect(judgeFootprint).toHaveBeenCalledWith({
    peakInUseMiB: 9000,
    vmMemoryMiB: 10000,
    oomKilledPods: [],
  });
  expect(judgeFootprint).not.toHaveBeenCalledWith(
    expect.objectContaining({ peakInUseMiB: 500 }),
  );
});

test("reads the OOMKilled pods since the run began on the wall clock, not the monotonic one", async () => {
  const { measurement, deps } = measurementWith();
  vi.mocked(deps.epochMilliseconds).mockReturnValue(5000);
  vi.mocked(deps.now).mockReturnValue(999_999);

  await measurement.measure();

  expect(parseOomKilledPods).toHaveBeenCalledWith("PODS", 5000);
});

test("a clean run reports a verdict with no breach and no breaches", async () => {
  const { measurement } = measurementWith();

  const result = await measurement.measure();

  expect(result.verdict).toEqual({ breached: false, breaches: [] });
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
    kubeContext: "k3d-kore-local",
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

test("fails with the cause named when the VM's memory in use cannot be read, and reports no verdict", async () => {
  const { measurement, run } = measurementWith();
  run.mockImplementation(async (command: string, args: readonly string[]) => {
    if (command === "docker" && args.length === 4) {
      throw new Error("Cannot connect to the Docker daemon");
    }
    return { stdout: reply(command, args), stderr: "", code: 0 };
  });

  await expect(measurement.measure()).rejects.toThrow(
    "reading the Docker VM memory in use failed: Cannot connect to the Docker daemon; check that Docker is running",
  );
  expect(judgeFootprint).not.toHaveBeenCalled();
});

test("fails with the cause named when the pod list cannot be read, and reports no verdict", async () => {
  const { measurement, run } = measurementWith();
  run.mockImplementation(async (command: string, args: readonly string[]) => {
    if (command === "kubectl") {
      throw new Error("connection refused");
    }
    return { stdout: reply(command, args), stderr: "", code: 0 };
  });

  await expect(measurement.measure()).rejects.toThrow(
    "reading the pods' OOMKilled state failed: connection refused; check that kubectl can reach the k3d-kore-local context",
  );
  expect(judgeFootprint).not.toHaveBeenCalled();
});

test("fails with the cause named when a read is unparseable", async () => {
  const { measurement } = measurementWith();
  vi.mocked(parseSwapUsedMiB).mockImplementation(() => {
    throw new Error("unreadable swap usage report");
  });

  await expect(measurement.measure()).rejects.toThrow(
    "reading the macOS swap usage failed: unreadable swap usage report; check that sysctl vm.swapusage runs on this Mac",
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
