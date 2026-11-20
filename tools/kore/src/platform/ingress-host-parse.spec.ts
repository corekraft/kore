import { expect, test } from "vitest";
import {
  parseAgentPaneCount,
  parseLinuxSwapUsedMiB,
  parseMemAvailableMiB,
} from "./ingress-host-parse.js";

const meminfo = [
  "MemTotal:       12251864 kB",
  "MemFree:         1048576 kB",
  "MemAvailable:    8388608 kB",
  "Buffers:           10240 kB",
].join("\n");

test("reads the VM's available memory in MiB from the MemAvailable line of /proc/meminfo", () => {
  expect(parseMemAvailableMiB(meminfo)).toBe(8192);
});

test.each([
  ["", 'unreadable VM memory report ""'],
  ["MemTotal: 1 kB", 'unreadable VM memory report "MemTotal: 1 kB"'],
])(
  "names the cause when /proc/meminfo has no MemAvailable: %j",
  (text, cause) => {
    expect(() => parseMemAvailableMiB(text)).toThrow(cause);
  },
);

test("reads the host's swap in use in MiB from SwapTotal less SwapFree in /proc/meminfo", () => {
  const swapped = [
    meminfo,
    "SwapTotal:       2097152 kB",
    "SwapFree:         524288 kB",
  ].join("\n");
  expect(parseLinuxSwapUsedMiB(swapped)).toBe(1536);
});

test("counts a host with no swap configured as zero swap used", () => {
  const noSwap = [
    meminfo,
    "SwapTotal:             0 kB",
    "SwapFree:              0 kB",
  ].join("\n");
  expect(parseLinuxSwapUsedMiB(noSwap)).toBe(0);
});

test.each([
  ["", 'unreadable host swap report ""'],
  [meminfo, "unreadable host swap report"],
  ["SwapTotal: 2097152 kB", "unreadable host swap report"],
])("names the cause when /proc/meminfo has no swap pair: %j", (text, cause) => {
  expect(() => parseLinuxSwapUsedMiB(text)).toThrow(cause);
});

const listing = (agents: unknown): string =>
  JSON.stringify({ result: { agents, type: "agent_list" } });

test("counts the agents herdr lists", () => {
  expect(parseAgentPaneCount(listing([{}, {}, {}]))).toBe(3);
});

test("counts zero for a herdr that lists no agents, which is an answer and not a missing source", () => {
  expect(parseAgentPaneCount(listing([]))).toBe(0);
});

test.each([
  ["not json", "herdr agent list did not print JSON"],
  [JSON.stringify({ result: {} }), "herdr agent list printed no agent list"],
  [listing("many"), "herdr agent list printed no agent list"],
])("names the cause when the herdr listing is unusable: %s", (text, cause) => {
  expect(() => parseAgentPaneCount(text)).toThrow(cause);
});
