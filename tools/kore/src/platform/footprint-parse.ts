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
  return {
    cpuMillicores: Math.round(Number(cpu[1]) * 10),
    memoryMiB: memoryInUseMiB(stats.MemUsage),
  };
}

const stringField = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** The memory in use (MiB) from the usage half of docker's MemUsage, for example `1.5GiB / 11.68GiB`. */
function memoryInUseMiB(memUsage: string | undefined): number {
  const memory = /^(\d+(?:\.\d+)?)([A-Za-z]+) \//.exec(memUsage ?? "");
  const factor = memory ? memoryUnits[memory[2] ?? ""] : undefined;
  if (!memory || factor === undefined) {
    throw new Error(`unreadable MemUsage ${JSON.stringify(memUsage)}`);
  }
  return Math.round(Number(memory[1]) * factor * 10) / 10;
}

/**
 * The Docker VM's memory in use (MiB): the sum of every running container's
 * memory from `docker stats --no-stream --format {{json .}}` with no container
 * named. Daemon and VM overhead outside any container is not counted, so the
 * figure is a floor. An empty listing fails, since a running cluster always
 * lists at least its server container.
 */
export function parseVmMemoryInUseMiB(stdout: string): number {
  const rows = stdout.split("\n").filter((row) => row.trim() !== "");
  if (rows.length === 0) {
    throw new Error(
      "unreadable Docker VM memory in use: docker stats listed no containers",
    );
  }
  return rows.reduce((total, row) => {
    let stats: unknown;
    try {
      stats = JSON.parse(row);
    } catch {
      throw new Error("docker stats output is not valid JSON");
    }
    if (!isRecord(stats)) {
      throw new Error("docker stats output is not valid JSON");
    }
    return total + memoryInUseMiB(stringField(stats["MemUsage"]));
  }, 0);
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

interface ContainerState {
  lastState?: { terminated?: { reason?: string; finishedAt?: string } };
}

interface PodListing {
  items?: {
    metadata?: { namespace?: string; name?: string };
    status?: {
      containerStatuses?: ContainerState[];
      initContainerStatuses?: ContainerState[];
    };
  }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A pod list: an object whose `items`, when present, is a list of objects. */
function isPodListing(value: unknown): value is PodListing {
  if (!isRecord(value)) {
    return false;
  }
  const items = value["items"];
  if (items === undefined) {
    return true;
  }
  return Array.isArray(items) && items.every(isRecord);
}

/**
 * The pods, as `namespace/name`, whose last state was OOMKilled at or after
 * `sinceMs` (epoch milliseconds), from `kubectl get pods -A -o json`. A pod
 * listed once however many containers were OOMKilled. A finish time that cannot
 * be read fails the read rather than letting the pod pass unjudged.
 */
export function parseOomKilledPods(stdout: string, sinceMs: number): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("kubectl pod list output is not valid JSON");
  }
  if (!isPodListing(parsed)) {
    throw new Error("kubectl pod list output is not a pod list");
  }
  const listing = parsed;
  const pods = new Set<string>();
  for (const item of listing.items ?? []) {
    const name = `${item.metadata?.namespace ?? ""}/${item.metadata?.name ?? ""}`;
    const containers = [
      ...(item.status?.containerStatuses ?? []),
      ...(item.status?.initContainerStatuses ?? []),
    ];
    if (oomKilledSince(containers, name, sinceMs)) {
      pods.add(name);
    }
  }
  return [...pods].sort();
}

function oomKilledSince(
  containers: ContainerState[],
  name: string,
  sinceMs: number,
): boolean {
  return containers.some((container) => {
    const terminated = container.lastState?.terminated;
    if (terminated?.reason !== "OOMKilled") {
      return false;
    }
    const finished = Date.parse(terminated.finishedAt ?? "");
    if (Number.isNaN(finished)) {
      throw new Error(`unreadable finishedAt for ${name}`);
    }
    return finished >= sinceMs;
  });
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
