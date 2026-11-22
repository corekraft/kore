import { expect, test } from "vitest";
import {
  parseContainerStats,
  parseOomKilledPods,
  parseLinuxSwapMiB,
  parseSwapTotalMiB,
  parseSwapUsedMiB,
  parseVmMemoryInUseMiB,
  parseVmMemoryMiB,
} from "./footprint-parse.js";

const stats = (cpu: string, memory: string): string =>
  JSON.stringify({ CPUPerc: cpu, MemUsage: memory });

const RUN_STARTED = Date.parse("2026-11-18T10:00:00Z");

const terminated = (reason: string, finishedAt: string) => ({
  lastState: { terminated: { reason, finishedAt } },
});

const pod = (
  namespace: string,
  name: string,
  containers: Record<string, unknown>[] = [{}],
  init: Record<string, unknown>[] = [],
) =>
  JSON.stringify({
    metadata: { namespace, name },
    status: { containerStatuses: containers, initContainerStatuses: init },
  });

const podList = (...pods: string[]): string =>
  JSON.stringify({ items: pods.map((text) => JSON.parse(text)) });

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
  ["null", "docker stats output is not valid JSON"],
  ["3", "docker stats output is not valid JSON"],
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

test("sums the memory in use across every running container, for the Docker VM's in-use figure", () => {
  const listing = [
    stats("1%", "1.5GiB / 11.68GiB"),
    stats("2%", "512MiB / 11.68GiB"),
  ].join("\n");
  expect(parseVmMemoryInUseMiB(listing)).toBe(2048);
});

test("fails with the cause when the container listing names no container, or a memory that cannot be read", () => {
  expect(() => parseVmMemoryInUseMiB("\n")).toThrow(
    "docker stats listed no containers",
  );
  expect(() => parseVmMemoryInUseMiB(stats("1%", "lots"))).toThrow(
    "unreadable MemUsage",
  );
});

test.each([
  ["null", "null"],
  ["a number", "3"],
  ["an array", "[]"],
])(
  "fails with the cause when a docker stats row is %s, not an object",
  (_label, row) => {
    expect(() => parseVmMemoryInUseMiB(row)).toThrow(
      "docker stats output is not valid JSON",
    );
  },
);

test("names each pod whose last state was OOMKilled since the run began, as namespace/name", () => {
  const text = podList(
    pod("platform", "keycloak-0", [
      terminated("OOMKilled", "2026-11-18T10:05:00Z"),
    ]),
    pod("argocd", "server-0", [terminated("Error", "2026-11-18T10:06:00Z")]),
    pod("kube-system", "coredns", [{}]),
  );
  expect(parseOomKilledPods(text, RUN_STARTED)).toEqual([
    "platform/keycloak-0",
  ]);
});

test("ignores an OOMKilled last state that ended before the run began", () => {
  const text = podList(
    pod("platform", "keycloak-0", [
      terminated("OOMKilled", "2026-11-18T09:59:59Z"),
    ]),
  );
  expect(parseOomKilledPods(text, RUN_STARTED)).toEqual([]);
});

test("lists a pod once however many of its containers were OOMKilled, and reads init containers too", () => {
  const text = podList(
    pod(
      "platform",
      "backstage-0",
      [terminated("OOMKilled", "2026-11-18T10:01:00Z")],
      [terminated("OOMKilled", "2026-11-18T10:02:00Z")],
    ),
  );
  expect(parseOomKilledPods(text, RUN_STARTED)).toEqual([
    "platform/backstage-0",
  ]);
});

test("returns no pods for a pod list with none OOMKilled, and for an empty list", () => {
  expect(parseOomKilledPods(podList(), RUN_STARTED)).toEqual([]);
  expect(
    parseOomKilledPods(
      podList(pod("platform", "keycloak-0", [{}])),
      RUN_STARTED,
    ),
  ).toEqual([]);
});

test("fails with the cause when the pod list is not JSON", () => {
  expect(() =>
    parseOomKilledPods("kubectl: connection refused", RUN_STARTED),
  ).toThrow("kubectl pod list output is not valid JSON");
});

test.each([
  ["null", "null"],
  ["a list", "[]"],
  ["items that are not a list", '{"items":"many"}'],
  ["an item that is not an object", '{"items":[null]}'],
])(
  "fails with the cause when the pod list is %s, not a pod list",
  (_label, text) => {
    expect(() => parseOomKilledPods(text, RUN_STARTED)).toThrow(
      "kubectl pod list output is not a pod list",
    );
  },
);

test("fails naming the pod when its OOMKilled termination has no readable finish time", () => {
  const text = podList(
    pod("platform", "keycloak-0", [terminated("OOMKilled", "")]),
  );
  expect(() => parseOomKilledPods(text, RUN_STARTED)).toThrow(
    "unreadable finishedAt for platform/keycloak-0",
  );
});

test("reads macOS swap total in MiB from the sysctl report", () => {
  const report =
    "vm.swapusage: total = 6144.00M  used = 4096.50M  free = 2047.50M  (encrypted)";
  expect(parseSwapTotalMiB(report)).toBe(6144);
  expect(parseSwapTotalMiB(report.replace("6144.00M", "2.00G"))).toBe(2048);
});

test("fails with the cause when the swap report has no total figure", () => {
  expect(() => parseSwapTotalMiB("sysctl: unknown oid")).toThrow(
    "unreadable swap usage report",
  );
});

test("reads Linux swap total in MiB and swap used as SwapTotal less SwapFree from /proc/meminfo", () => {
  const meminfo =
    "MemTotal:       12251864 kB\nSwapTotal:      2097152 kB\nSwapFree:       1048576 kB\n";
  expect(parseLinuxSwapMiB(meminfo)).toEqual({ totalMiB: 2048, usedMiB: 1024 });
});

test("reads a host with no swap as zero total and zero used", () => {
  const meminfo =
    "MemTotal:       12251864 kB\nSwapTotal:             0 kB\nSwapFree:              0 kB\n";
  expect(parseLinuxSwapMiB(meminfo)).toEqual({ totalMiB: 0, usedMiB: 0 });
});

test("fails with the cause when /proc/meminfo has no swap total or no swap free figure", () => {
  expect(() => parseLinuxSwapMiB("MemTotal: 1 kB\nSwapFree: 1 kB")).toThrow(
    "unreadable host swap report",
  );
  expect(() => parseLinuxSwapMiB("MemTotal: 1 kB\nSwapTotal: 1 kB")).toThrow(
    "unreadable host swap report",
  );
});
