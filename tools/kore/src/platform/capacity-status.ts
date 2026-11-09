import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { errorMessage } from "./probe.js";

// Docs: docs/operations/resource-budgets.md

export const capacityStatusName = "capacity";
/** Requests at or above this share of allocatable resources are a warning. */
export const capacityWarningPercent = 80;

export interface CapacityFindings {
  cpuRequestedPercent: number;
  memoryRequestedPercent: number;
  warningPercent: number;
}

export interface CapacityStatus {
  name: string;
  namespace: string;
  status: "ready" | "missing" | "degraded";
  detail: string;
  capacity?: CapacityFindings;
}

/** CPU cores from a Kubernetes quantity such as `250m` or `2`. */
export function parseCpu(quantity: string): number {
  return quantity.endsWith("m")
    ? Number(quantity.slice(0, -1)) / 1000
    : Number(quantity);
}

const memoryUnits: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

/** Memory in MiB from a Kubernetes quantity such as `512Mi` or `1073741824`. */
export function parseMemory(quantity: string): number {
  const match = /^(\d+(?:\.\d+)?)([A-Za-z]{0,2})$/.exec(quantity);
  const unit = match?.[2] ?? "";
  if (!match || (unit !== "" && !(unit in memoryUnits))) {
    throw new Error(`unreadable memory quantity ${quantity}`);
  }
  return Math.round((Number(match[1]) * (memoryUnits[unit] ?? 1)) / 1024 ** 2);
}

interface Quantities {
  cpu?: string;
  memory?: string;
}
interface NodeList {
  items?: { status?: { allocatable?: Quantities } }[];
}
interface PodList {
  items?: {
    status?: { phase?: string };
    spec?: { containers?: { resources?: { requests?: Quantities } }[] };
  }[];
}

async function kubectlJson<T>(
  repository: Repository,
  runner: Runner,
  resource: string,
): Promise<T> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "get",
      resource,
      ...(resource === "pods" ? ["--all-namespaces"] : []),
      "--output",
      "json",
    ],
    { capture: true },
  );
  return JSON.parse(stdout) as T;
}

interface Totals {
  cpu: number;
  memory: number;
}

function allocatable(nodes: NodeList): Totals {
  const total = { cpu: 0, memory: 0 };
  for (const node of nodes.items ?? []) {
    total.cpu += parseCpu(node.status?.allocatable?.cpu ?? "0");
    total.memory += parseMemory(node.status?.allocatable?.memory ?? "0");
  }
  return total;
}

/** Init containers are excluded: their requests are released before the workload runs. */
function requested(pods: PodList): Totals {
  const total = { cpu: 0, memory: 0 };
  const running = (pods.items ?? []).filter(
    (pod) =>
      pod.status?.phase !== "Succeeded" && pod.status?.phase !== "Failed",
  );
  for (const pod of running) {
    for (const container of pod.spec?.containers ?? []) {
      const requests = container.resources?.requests;
      total.cpu += parseCpu(requests?.cpu ?? "0");
      total.memory += parseMemory(requests?.memory ?? "0");
    }
  }
  return total;
}

function percent(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

function warnings(capacity: CapacityFindings): string[] {
  const found: string[] = [];
  if (capacity.cpuRequestedPercent >= capacityWarningPercent) {
    found.push(
      `CPU requests are ${capacity.cpuRequestedPercent}% of allocatable; raise cluster.cpus in the environment overlay and recreate the profile`,
    );
  }
  if (capacity.memoryRequestedPercent >= capacityWarningPercent) {
    found.push(
      `memory requests are ${capacity.memoryRequestedPercent}% of allocatable; raise cluster.memoryMB in the environment overlay and recreate the profile`,
    );
  }
  return found;
}

/**
 * Compares the CPU and memory that scheduled pods request with what the nodes
 * can allocate, and warns at `capacityWarningPercent`. Read-only and
 * audit-only: it never fails `platform up`.
 */
export async function capacityStatus(
  repository: Repository,
  runner: Runner,
): Promise<CapacityStatus> {
  const identity = { name: capacityStatusName, namespace: "cluster" };
  try {
    const nodes = await kubectlJson<NodeList>(repository, runner, "nodes");
    const pods = await kubectlJson<PodList>(repository, runner, "pods");
    const have = allocatable(nodes);
    const used = requested(pods);
    const capacity = {
      cpuRequestedPercent: percent(used.cpu, have.cpu),
      memoryRequestedPercent: percent(used.memory, have.memory),
      warningPercent: capacityWarningPercent,
    };
    const problems = warnings(capacity);
    return problems.length
      ? {
          ...identity,
          status: "degraded",
          detail: problems.join("; "),
          capacity,
        }
      : {
          ...identity,
          status: "ready",
          detail: `requests are ${capacity.cpuRequestedPercent}% of CPU and ${capacity.memoryRequestedPercent}% of memory (warning at ${capacityWarningPercent}%)`,
          capacity,
        };
  } catch (error) {
    return {
      ...identity,
      status: "missing",
      detail: `capacity could not be read: ${errorMessage(error)}`,
    };
  }
}
