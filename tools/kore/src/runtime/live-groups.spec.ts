import { EventEmitter } from "node:events";
import { expect, test } from "vitest";
import { LiveGroups, installSignalReaper } from "./live-groups.js";

function fakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    exits: number[];
    exit(code: number): void;
  };
  proc.exits = [];
  proc.exit = (code: number) => void proc.exits.push(code);
  return proc;
}

test("SIGINT and SIGTERM signal every live group, then exit 130 and 143", () => {
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    const groups = new LiveGroups();
    groups.add(11);
    groups.add(22);
    const sent: [number, string][] = [];
    const proc = fakeProcess();
    installSignalReaper(proc, groups, (pid, sig) => void sent.push([pid, sig]));
    proc.emit(signal);
    expect(sent).toEqual([
      [11, "SIGTERM"],
      [22, "SIGTERM"],
    ]);
    expect(proc.exits).toEqual([code]);
  }
});

test("a group that already exited is not signalled", () => {
  const groups = new LiveGroups();
  groups.add(11);
  groups.delete(11);
  const sent: number[] = [];
  const proc = fakeProcess();
  installSignalReaper(proc, groups, (pid) => void sent.push(pid));
  proc.emit("SIGTERM");
  expect(sent).toEqual([]);
});

test("another signal handler, such as the live lock's, still gets to run and decides the exit", () => {
  const groups = new LiveGroups();
  const proc = fakeProcess();
  installSignalReaper(proc, groups, () => {});
  proc.on("SIGTERM", () => {});
  proc.emit("SIGTERM");
  expect(proc.exits).toEqual([]);
});

test("a normal exit kills groups that are still running", () => {
  const groups = new LiveGroups();
  groups.add(33);
  const sent: [number, string][] = [];
  const proc = fakeProcess();
  installSignalReaper(proc, groups, (pid, sig) => void sent.push([pid, sig]));
  proc.emit("exit");
  expect(sent).toEqual([[33, "SIGKILL"]]);
});
