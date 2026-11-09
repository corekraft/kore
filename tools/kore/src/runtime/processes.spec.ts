import { expect, test, vi } from "vitest";
import { terminateMatching, type ProcessEntry } from "./processes.js";

const table: ProcessEntry[] = [
  { pid: 10, command: "ssh a" },
  { pid: 11, command: "ssh b" },
  { pid: process.pid, command: "ssh a" },
];

test("terminates only matching processes, never the caller, and reports each", async () => {
  const signalled: [number, string][] = [];
  const lines: string[] = [];
  const killed = await terminateMatching(
    (entry) => entry.command === "ssh a",
    (entry) => `stopped ${entry.pid}`,
    {
      listProcesses: async () => table,
      signalProcess: (pid, signal) => void signalled.push([pid, signal]),
      report: (line) => void lines.push(line),
    },
  );
  expect(killed).toEqual([10]);
  expect(signalled).toEqual([[10, "SIGTERM"]]);
  expect(lines).toEqual(["stopped 10"]);
});

test("nothing matching is a silent no-op", async () => {
  const signalled: number[] = [];
  const lines: string[] = [];
  const killed = await terminateMatching(
    () => false,
    () => "x",
    {
      listProcesses: async () => table,
      signalProcess: (pid) => void signalled.push(pid),
      report: (line) => void lines.push(line),
    },
  );
  expect(killed).toEqual([]);
  expect(signalled).toEqual([]);
  expect(lines).toEqual([]);
});

test("a process that vanished before the signal is not an error", async () => {
  const killed = await terminateMatching(
    () => true,
    () => "x",
    {
      listProcesses: async () => [{ pid: 10, command: "c" }],
      signalProcess: () => {
        throw Object.assign(new Error("gone"), { code: "ESRCH" });
      },
      report: () => undefined,
    },
  );
  expect(killed).toEqual([]);
});

test("lists host processes with pid and full command line", async () => {
  const { listHostProcesses } =
    await vi.importActual<typeof import("./processes.js")>("./processes.js");
  const entries = await listHostProcesses();
  const self = entries.find((entry) => entry.pid === process.pid);
  expect(self?.command).toContain("node");
});
