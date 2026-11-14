import { freemem, loadavg, totalmem } from "node:os";
import { beforeEach, expect, it, vi } from "vitest";
import { systemHostLoad } from "./host-load.js";
import {
  parseFreeSwap,
  parseMemoryPressure,
  parseSwapUsage,
} from "./host-sample-parse.js";
import type { Runner } from "./runner.js";

vi.mock("node:os");
vi.mock("./host-sample-parse.js");

const run = vi.fn<Runner["run"]>();
const runner: Runner = { run };
const reply = (code: number, stdout = "") => ({ code, stdout, stderr: "" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadavg).mockReturnValue([2.5, 1, 1]);
});

it("reads the host's one-minute load average, the first of the three", () => {
  vi.mocked(loadavg).mockReturnValue([44.5, 30, 20]);

  expect(systemHostLoad.oneMinute()).toBe(44.5);
});

it("reads a host that reports no load average as infinitely loaded, so a ceiling refuses", () => {
  vi.mocked(loadavg).mockReturnValue([]);

  expect(systemHostLoad.oneMinute()).toBe(Number.POSITIVE_INFINITY);
});

it("samples load, memory pressure and swap on macOS from the system's own reports", async () => {
  run.mockImplementation((command) =>
    Promise.resolve(reply(0, `${command} output`)),
  );
  vi.mocked(parseMemoryPressure).mockReturnValue(0.4);
  vi.mocked(parseSwapUsage).mockReturnValue(2048);

  expect(await systemHostLoad.sample(runner, "darwin")).toEqual({
    load: 2.5,
    memory: 0.4,
    swap: 2048,
  });
  expect(run.mock.calls.map(([command, args]) => [command, ...args])).toEqual([
    ["memory_pressure", "-Q"],
    ["sysctl", "-n", "vm.swapusage"],
  ]);
  expect(parseMemoryPressure).toHaveBeenCalledWith("memory_pressure output");
  expect(parseSwapUsage).toHaveBeenCalledWith("sysctl output");
});

it("samples memory from the standard library and swap from free elsewhere", async () => {
  vi.mocked(freemem).mockReturnValue(4);
  vi.mocked(totalmem).mockReturnValue(16);
  run.mockResolvedValue(reply(0, "free output"));
  vi.mocked(parseFreeSwap).mockReturnValue(99);

  expect(await systemHostLoad.sample(runner, "linux")).toEqual({
    load: 2.5,
    memory: 0.25,
    swap: 99,
  });
  expect(run.mock.calls).toEqual([["free", ["-b"]]]);
});

it("leaves a field out when its report fails or cannot be parsed, never as zero", async () => {
  run.mockResolvedValueOnce(reply(1)).mockResolvedValueOnce(reply(0, "odd"));
  vi.mocked(parseSwapUsage).mockReturnValue(undefined);

  expect(await systemHostLoad.sample(runner, "darwin")).toEqual({ load: 2.5 });
});

it("leaves a field out when the report cannot even start", async () => {
  run.mockRejectedValue(new Error("spawn ENOENT"));

  expect(await systemHostLoad.sample(runner, "darwin")).toEqual({ load: 2.5 });
});

it("samples a host with no load average as infinitely loaded", async () => {
  vi.mocked(loadavg).mockReturnValue([]);
  run.mockResolvedValue(reply(1));

  expect(await systemHostLoad.sample(runner, "darwin")).toEqual({
    load: Number.POSITIVE_INFINITY,
  });
});
