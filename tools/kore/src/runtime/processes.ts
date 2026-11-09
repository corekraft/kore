import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Docs: docs/decisions/0060-tunnel-recovery-on-demand.md

export interface ProcessEntry {
  pid: number;
  command: string;
}

export interface ProcessControl {
  listProcesses?: () => Promise<ProcessEntry[]>;
  signalProcess?: (pid: number, signal: NodeJS.Signals) => void;
  report?: (line: string) => void;
}

/** Host processes with their full command lines, from `ps`. */
export async function listHostProcesses(): Promise<ProcessEntry[]> {
  const { stdout } = await promisify(execFile)(
    "ps",
    ["-axo", "pid=,command="],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const entries: ProcessEntry[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (match) {
      entries.push({ pid: Number(match[1]), command: match[2]! });
    }
  }
  return entries;
}

/**
 * Sends SIGTERM to every listed process whose full command line `matches`,
 * never to the caller, and reports one line per process stopped. A process
 * that exits first is not an error. Returns the pids signalled.
 */
export async function terminateMatching(
  matches: (entry: ProcessEntry) => boolean,
  describe: (entry: ProcessEntry) => string,
  control: ProcessControl = {},
): Promise<number[]> {
  const signal = control.signalProcess ?? process.kill.bind(process);
  const report =
    control.report ??
    ((line: string) => void process.stderr.write(`${line}\n`));
  const stopped: number[] = [];
  for (const entry of await (control.listProcesses ?? listHostProcesses)()) {
    if (entry.pid === process.pid || !matches(entry)) {
      continue;
    }
    try {
      signal(entry.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        continue;
      }
      throw error;
    }
    stopped.push(entry.pid);
    report(describe(entry));
  }
  return stopped;
}
