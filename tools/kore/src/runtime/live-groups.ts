import type { Signal } from "./watchdog.js";

/** The process groups of running children that lead a group of their own. */
export class LiveGroups {
  private readonly pids = new Set<number>();
  add(pid: number): void {
    this.pids.add(pid);
  }
  delete(pid: number): void {
    this.pids.delete(pid);
  }
  [Symbol.iterator](): IterableIterator<number> {
    return [...this.pids][Symbol.iterator]();
  }
}

/** Signals a whole process group; a group that is already gone is not an error. */
export function killGroup(pid: number, signal: Signal): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

interface ProcessLike {
  once(event: string, listener: () => void): unknown;
  listenerCount(event: string): number;
  exit(code: number): unknown;
}

const signalExitCodes = [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const;

/**
 * Detached children no longer receive the terminal's Ctrl-C, and Node's default
 * signal handling ends Kore without an `exit` event, so without this a killed
 * Kore would leave kubectl, helm or k3d running with the environment lock gone.
 * On SIGINT or SIGTERM every live group gets SIGTERM, then Kore exits 130 or
 * 143 unless another handler (the live lock's) is left to decide. A
 * normal exit kills any group still running.
 */
export function installSignalReaper(
  proc: ProcessLike,
  groups: LiveGroups,
  send: (pid: number, signal: Signal) => void,
): void {
  for (const [signal, code] of signalExitCodes) {
    proc.once(signal, () => {
      for (const pid of groups) {
        send(pid, "SIGTERM");
      }
      if (proc.listenerCount(signal) === 0) {
        proc.exit(code);
      }
    });
  }
  proc.once("exit", () => {
    for (const pid of groups) {
      send(pid, "SIGKILL");
    }
  });
}

export const liveGroups = new LiveGroups();
installSignalReaper(process, liveGroups, killGroup);
