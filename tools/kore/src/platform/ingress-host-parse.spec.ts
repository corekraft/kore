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

// A scrubbed copy of hc 0.1.21's `hc ls --all --json` on a host running claude: a live claude is agent
// "claude-code" with a status, a finished claude child is agent "claude", a plain process is its own name.
const RECORDED_LS =
  '{"hidden_finished":0,"terminals":[{"address":"t4","agent":"claude-code","cwd":"/home/x","state":"live","status":"done","turn":18,"where":"kore / 1"},{"address":"t1b","agent":"claude","cwd":"/home/x/kore","exit_code":0,"parent":"t17","reason":"exited","state":"finished","turn":0,"where":"tools / 1"},{"address":"t12y","agent":"node","cwd":"/home/x/kore","name":"ledger-watch","parent":"t3f","state":"live","turn":0,"where":"tools / 1"},{"address":"t133","agent":"claude-code","cwd":"/home/x/kore","name":"writer","parent":"t3f","state":"live","status":"working","turn":0,"where":"tools / 1"}]}';

test("counts the live claude terminals of a recorded hc listing, not the finished claude child or the node process", () => {
  expect(parseAgentPaneCount(RECORDED_LS)).toBe(2);
});
