// Docs: infra/plans/2-implementation.md#step-7-bootstrap-registry-image-trust-controllers-and-crd-ownership
//
// The pure half of the footprint measurement: reading what `docker stats`,
// `sysctl vm.swapusage` and `docker info` print. Unreadable output names what
// was unreadable, so a failed run says which read broke.

export interface ContainerUsage {
  cpuMillicores: number;
  memoryMiB: number;
}

const memoryUnits: Record<string, number> = {
  B: 1 / 1024 ** 2,
  KiB: 1 / 1024,
  MiB: 1,
  GiB: 1024,
};

/** CPU (millicores; docker prints 100% for one core) and memory (MiB) of one container. */
export function parseContainerStats(stdout: string): ContainerUsage {
  let stats: { CPUPerc?: string; MemUsage?: string };
  try {
    stats = JSON.parse(stdout) as typeof stats;
  } catch {
    throw new Error("docker stats output is not valid JSON");
  }
  const cpu = /^(\d+(?:\.\d+)?)%$/.exec(stats.CPUPerc ?? "");
  if (!cpu) {
    throw new Error(`unreadable CPUPerc ${JSON.stringify(stats.CPUPerc)}`);
  }
  const memory = /^(\d+(?:\.\d+)?)([A-Za-z]+) \//.exec(stats.MemUsage ?? "");
  const factor = memory ? memoryUnits[memory[2] ?? ""] : undefined;
  if (!memory || factor === undefined) {
    throw new Error(`unreadable MemUsage ${JSON.stringify(stats.MemUsage)}`);
  }
  return {
    cpuMillicores: Math.round(Number(cpu[1]) * 10),
    memoryMiB: Math.round(Number(memory[1]) * factor * 10) / 10,
  };
}

/** Swap in use (MiB) from `sysctl vm.swapusage`. */
export function parseSwapUsedMiB(stdout: string): number {
  const used = /used = (\d+(?:\.\d+)?)([MG])/.exec(stdout);
  if (!used) {
    throw new Error(
      `unreadable swap usage report ${JSON.stringify(stdout.trim())}`,
    );
  }
  return Number(used[1]) * (used[2] === "G" ? 1024 : 1);
}

/** The Docker VM's total memory (MiB) from `docker info --format {{.MemTotal}}`. */
export function parseVmMemoryMiB(stdout: string): number {
  const bytes = Number(stdout.trim());
  if (!Number.isFinite(bytes) || bytes <= 0 || stdout.trim() === "") {
    throw new Error(
      `unreadable Docker VM memory ${JSON.stringify(stdout.trim())}`,
    );
  }
  return Math.round(bytes / 1024 ** 2);
}
