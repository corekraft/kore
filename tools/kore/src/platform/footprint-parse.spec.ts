import { expect, test } from "vitest";
import {
  parseContainerStats,
  parseSwapUsedMiB,
  parseVmMemoryMiB,
} from "./footprint-parse.js";

const stats = (cpu: string, memory: string): string =>
  JSON.stringify({ CPUPerc: cpu, MemUsage: memory });

test("reads container CPU as millicores, where 100% is one core", () => {
  expect(
    parseContainerStats(stats("35.2%", "1.5GiB / 11.68GiB")).cpuMillicores,
  ).toBe(352);
});

test("reads container memory in MiB from the usage half of docker's MemUsage", () => {
  expect(parseContainerStats(stats("1%", "1.5GiB / 11.68GiB")).memoryMiB).toBe(
    1536,
  );
  expect(parseContainerStats(stats("1%", "512MiB / 2GiB")).memoryMiB).toBe(512);
  expect(parseContainerStats(stats("1%", "2048KiB / 2GiB")).memoryMiB).toBe(2);
});

test.each([
  ["not json", "docker stats output is not valid JSON"],
  [stats("", "1MiB / 2GiB"), "unreadable CPUPerc"],
  [stats("1%", "lots"), "unreadable MemUsage"],
  [stats("1%", "5 parsecs / 2GiB"), "unreadable MemUsage"],
])("names the cause when docker stats is unusable: %s", (text, cause) => {
  expect(() => parseContainerStats(text)).toThrow(cause);
});

test("reads macOS swap used in MiB from the sysctl report", () => {
  const report =
    "vm.swapusage: total = 6144.00M  used = 4096.50M  free = 2047.50M  (encrypted)";
  expect(parseSwapUsedMiB(report)).toBe(4096.5);
  expect(parseSwapUsedMiB(report.replace("4096.50M", "2.00G"))).toBe(2048);
});

test("fails with the cause when the swap report has no used figure", () => {
  expect(() => parseSwapUsedMiB("sysctl: unknown oid")).toThrow(
    "unreadable swap usage report",
  );
});

test("reads the Docker VM's total memory from bytes into MiB", () => {
  expect(parseVmMemoryMiB("12247236608\n")).toBe(11680);
});

test("fails with the cause when the VM memory is not a positive byte count", () => {
  expect(() => parseVmMemoryMiB("0")).toThrow("unreadable Docker VM memory");
  expect(() => parseVmMemoryMiB("")).toThrow("unreadable Docker VM memory");
});
