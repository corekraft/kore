import { freemem, loadavg, totalmem } from "node:os";
import {
  parseFreeSwap,
  parseMemoryPressure,
  parseSwapUsage,
} from "./host-sample-parse.js";
import type { Runner } from "./runner.js";

/**
 * One reading of the host. A reading that is unavailable is absent, never zero.
 * `load` is infinite when the host reports none, so a load check fails closed.
 */
export interface HostSample {
  load: number;
  /** Free memory as a share of total, 0 to 1. */
  memory?: number;
  /** Swap in use, in bytes. */
  swap?: number;
}

/** The host's load and pressure, read through an interface so specs never read the real host. */
export type LoadReader = Pick<HostLoad, "oneMinute">;

export interface HostLoad {
  oneMinute(): number;
  sample(runner: Runner, platform?: NodeJS.Platform): Promise<HostSample>;
}

async function report(
  runner: Runner,
  command: string,
  args: readonly string[],
): Promise<string | undefined> {
  try {
    const result = await runner.run(command, args);
    return result.code === 0 ? result.stdout : undefined;
  } catch {
    return undefined;
  }
}

async function readOnMac(runner: Runner) {
  const pressure = await report(runner, "memory_pressure", ["-Q"]);
  const swap = await report(runner, "sysctl", ["-n", "vm.swapusage"]);
  return {
    memory: pressure === undefined ? undefined : parseMemoryPressure(pressure),
    swap: swap === undefined ? undefined : parseSwapUsage(swap),
  };
}

async function readElsewhere(runner: Runner) {
  const free = await report(runner, "free", ["-b"]);
  return {
    memory: freemem() / totalmem(),
    swap: free === undefined ? undefined : parseFreeSwap(free),
  };
}

/** Reads the real host. A host that reports no load average reads as infinitely loaded. */
export const systemHostLoad: HostLoad = {
  oneMinute: () => loadavg()[0] ?? Number.POSITIVE_INFINITY,
  async sample(runner, platform = process.platform) {
    const { memory, swap } =
      platform === "darwin"
        ? await readOnMac(runner)
        : await readElsewhere(runner);
    return {
      load: systemHostLoad.oneMinute(),
      ...(memory === undefined ? {} : { memory }),
      ...(swap === undefined ? {} : { swap }),
    };
  },
};
