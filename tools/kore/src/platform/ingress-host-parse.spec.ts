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

const listing = (terminals: unknown): string =>
  JSON.stringify({ hidden_finished: 0, terminals });

const claude = { address: "t1", agent: "claude-code", state: "live" };
const node = { address: "t2", agent: "node", state: "live" };

test("counts the claude sessions hc lists, and not the plain processes beside them", () => {
  expect(parseAgentPaneCount(listing([claude, claude, node]))).toBe(2);
});

test("counts zero for an hc that lists no agent session, which is an answer and not a missing source", () => {
  expect(parseAgentPaneCount(listing([node]))).toBe(0);
  expect(parseAgentPaneCount(listing([]))).toBe(0);
});

test.each([
  ["not json", "hc ls did not print JSON"],
  [JSON.stringify({ hidden_finished: 0 }), "hc ls printed no terminal list"],
  [listing("many"), "hc ls printed no terminal list"],
])("names the cause when the hc listing is unusable: %s", (text, cause) => {
  expect(() => parseAgentPaneCount(text)).toThrow(cause);
});
