import { describe, expect, it, vi } from "vitest";
import { terminateMatching, type ProcessEntry } from "./processes.js";

const ENTRIES: ProcessEntry[] = [
  { pid: 10, command: "kore local up" },
  { pid: 11, command: "kubectl get pods" },
  { pid: process.pid, command: "this test runner" },
];

describe("terminateMatching under the unit setup", () => {
  it("in a unit test, a default listing sees no host process, so nothing is signalled", async () => {
    const signalProcess = vi.fn<(pid: number, signal: string) => void>();

    const stopped = await terminateMatching(
      () => true,
      () => "",
      {
        signalProcess: signalProcess as never,
        report: () => undefined,
      },
    );

    expect(stopped).toEqual([]);
    expect(signalProcess).not.toHaveBeenCalled();
  });
});

describe("terminateMatching", () => {
  it("sends SIGTERM to each matching process, reports it, and returns the pids stopped", async () => {
    const signalProcess = vi.fn<(pid: number, signal: string) => void>();
    const report = vi.fn<(line: string) => void>();

    const stopped = await terminateMatching(
      (entry) => entry.command.startsWith("kore"),
      (entry) => `stopping ${entry.pid}`,
      {
        listProcesses: async () => ENTRIES,
        signalProcess: signalProcess as never,
        report,
      },
    );

    expect(stopped).toEqual([10]);
    expect(signalProcess).toHaveBeenCalledWith(10, "SIGTERM");
    expect(signalProcess).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("stopping 10");
  });

  it("never signals the calling process, even when it matches", async () => {
    const signalProcess = vi.fn<(pid: number, signal: string) => void>();

    const stopped = await terminateMatching(
      () => true,
      () => "",
      {
        listProcesses: async () => [{ pid: process.pid, command: "self" }],
        signalProcess: signalProcess as never,
        report: () => undefined,
      },
    );

    expect(stopped).toEqual([]);
    expect(signalProcess).not.toHaveBeenCalled();
  });

  it("treats a process that exited before the signal as already stopped, not as an error", async () => {
    const gone = Object.assign(new Error("no such process"), {
      code: "ESRCH",
    });
    const report = vi.fn<(line: string) => void>();

    const stopped = await terminateMatching(
      () => true,
      (entry) => `stopping ${entry.pid}`,
      {
        listProcesses: async () => [ENTRIES[0]!],
        signalProcess: () => {
          throw gone;
        },
        report,
      },
    );

    expect(stopped).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it("rethrows any other signalling failure, since it is not a process that already left", async () => {
    const denied = Object.assign(new Error("operation not permitted"), {
      code: "EPERM",
    });

    await expect(
      terminateMatching(
        () => true,
        () => "",
        {
          listProcesses: async () => [ENTRIES[0]!],
          signalProcess: () => {
            throw denied;
          },
          report: () => undefined,
        },
      ),
    ).rejects.toBe(denied);
  });
});
