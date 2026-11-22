import { beforeEach, expect, test, vi } from "vitest";
import { fakeRunner } from "./platform-support.js";
import {
  FootprintMeasurement,
  type FootprintDeps,
  type FootprintOptions,
} from "./footprint-measurement.js";
import {
  parseContainerStats,
  parseLinuxSwapMiB,
  parseOomKilledPods,
  parseSwapTotalMiB,
  parseSwapUsedMiB,
  parseVmMemoryInUseMiB,
  parseVmMemoryMiB,
} from "./footprint-parse.js";
import { judgeFootprint } from "./footprint-verdict.js";
import { summarizeFootprint } from "./footprint-summary.js";

// The platform's swap read is what these tests cover. The parsers, the
// arithmetic and the verdict are same-domain units, so they are stubs here; their
// own specs prove what they read, compute and judge.
vi.mock("./footprint-parse.js", () => ({
  parseContainerStats: vi.fn(),
  parseLinuxSwapMiB: vi.fn(),
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

function measurementWith(platform: NodeJS.Platform, load = 1) {
  const { runner, run } = fakeRunner(reply);
  const deps: FootprintDeps = {
    sleep: vi.fn<(seconds: number) => Promise<void>>(async () => undefined),
    loadAverage: vi.fn(() => load),
    now: vi.fn(() => 0),
    epochMilliseconds: vi.fn(() => 5000),
    platform,
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
  vi.mocked(parseLinuxSwapMiB).mockReturnValue({
    totalMiB: 2048,
    usedMiB: 300,
  });
  vi.mocked(parseContainerStats).mockReturnValue({
    cpuMillicores: 300,
    memoryMiB: 3000,
  });
  vi.mocked(parseVmMemoryInUseMiB).mockReturnValue(4000);
  vi.mocked(parseOomKilledPods).mockReturnValue([]);
  vi.mocked(summarizeFootprint).mockReturnValue(SUMMARY);
  vi.mocked(judgeFootprint).mockReturnValue(CLEAN);
});

test("refuses a platform other than linux or darwin, naming the supported ones, and reads nothing", async () => {
  const { measurement, run, deps } = measurementWith("win32");

  await expect(measurement.measure()).rejects.toThrow(
    "host platform win32 is not supported; the footprint measurement reads swap on linux and darwin",
  );
  expect(run).not.toHaveBeenCalled();
  expect(deps.readFile).not.toHaveBeenCalled();
  expect(deps.sleep).not.toHaveBeenCalled();
});

test("on linux, reads swap from /proc/meminfo at each sample, never from sysctl, and reports the swap total", async () => {
  const { measurement, run, deps } = measurementWith("linux");

  const result = await measurement.measure();

  expect(vi.mocked(deps.readFile).mock.calls).toEqual([
    ["/proc/meminfo"],
    ["/proc/meminfo"],
  ]);
  expect(parseLinuxSwapMiB).toHaveBeenCalledWith("MEMINFO");
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
    [
      "docker",
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
      "k3d-kore-local-server-0",
    ],
    ["docker", "stats", "--no-stream", "--format", "{{json .}}"],
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
  expect(result.samples.map((sample) => sample.swapMiB)).toEqual([300, 300]);
  expect(result).toMatchObject({ platform: "linux", swapTotalMiB: 2048 });
});

test("on linux, a host with no swap reads zero swap in use and zero swap total", async () => {
  const { measurement } = measurementWith("linux");
  vi.mocked(parseLinuxSwapMiB).mockReturnValue({ totalMiB: 0, usedMiB: 0 });

  const result = await measurement.measure();

  expect(result.samples.map((sample) => sample.swapMiB)).toEqual([0, 0]);
  expect(result.swapTotalMiB).toBe(0);
});

test("on linux, an unreadable /proc/meminfo fails naming the read and how to fix it, and reports no verdict", async () => {
  const { measurement, deps } = measurementWith("linux");
  vi.mocked(deps.readFile).mockRejectedValueOnce(
    new Error("permission denied"),
  );

  await expect(measurement.measure()).rejects.toThrow(
    "reading the host's swap in /proc/meminfo failed: permission denied; check that /proc/meminfo is readable on this host",
  );
  expect(judgeFootprint).not.toHaveBeenCalled();
});

test("on linux, a /proc/meminfo with no swap pair fails with the cause named", async () => {
  const { measurement } = measurementWith("linux");
  vi.mocked(parseLinuxSwapMiB).mockImplementation(() => {
    throw new Error("unreadable host swap report");
  });

  await expect(measurement.measure()).rejects.toThrow(
    "reading the host's swap in /proc/meminfo failed: unreadable host swap report; check that /proc/meminfo is readable on this host",
  );
});

test("on darwin, reads swap from sysctl as before, reports the swap total, and never reads /proc/meminfo", async () => {
  const { measurement, deps } = measurementWith("darwin");

  const result = await measurement.measure();

  expect(parseSwapUsedMiB).toHaveBeenCalledWith("SWAP");
  expect(parseSwapTotalMiB).toHaveBeenCalledWith("SWAP");
  expect(deps.readFile).not.toHaveBeenCalled();
  expect(result).toMatchObject({ platform: "darwin", swapTotalMiB: 6144 });
});
