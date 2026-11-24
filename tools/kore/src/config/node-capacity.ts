// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md
import type { Environment } from "./types.js";

/** One node unless an overlay declares more (ADR 0152). */
export const DEFAULT_NODE_COUNT = 1;

/** The share of the budget app quotas may commit (owner decision on #1480). */
export const DEFAULT_COMMITTED_FRACTION = 0.8;

/** The node count the environment runs; unset reads as one. */
export function nodeCount(environment: Environment): number {
  return environment.nodeCount ?? DEFAULT_NODE_COUNT;
}

/** The share of the budget app quotas may commit; unset reads as 0.8. */
export function committedFraction(environment: Environment): number {
  return environment.committedFraction ?? DEFAULT_COMMITTED_FRACTION;
}

/**
 * The one-node budget. Judged only when every kubelet reserve and the disk
 * reserve are declared; otherwise it names the fields to fill, and no capacity
 * verdict is made on it.
 */
export type NodeBudget =
  | {
      judged: true;
      nodes: number;
      perNode: { cpuMillis: number; memoryMiB: number; diskGiB: number };
    }
  | { judged: false; missing: string[] };

type Kind = "cpu" | "memory" | "disk";

/** A reserve as written in the overlay: its field path, its text, and its kind. */
interface Field {
  path: string;
  text: string | undefined;
  kind: Kind;
}

/** A reserve read to a number in its own unit, or undefined when absent or unreadable. */
interface Reading {
  path: string;
  value: number | undefined;
}

/** The six reserves the budget reads, by name. */
interface ReserveFields {
  kubeCpu: Field;
  kubeMemory: Field;
  systemCpu: Field;
  systemMemory: Field;
  evictionMemory: Field;
  disk: Field;
}

const cpuQuantity = /^(\d+(?:\.\d+)?)(m)?$/;
const memoryQuantity = /^(\d+)(Ki|Mi|Gi|Ti)$/;
const diskQuantity = /^(\d+)(g|Gi|Ti)$/;

const memoryUnits = new Map<string, number>([
  ["Ki", 1 / 1024],
  ["Mi", 1],
  ["Gi", 1024],
  ["Ti", 1024 * 1024],
]);
const diskUnits = new Map<string, number>([
  ["g", 1],
  ["Gi", 1],
  ["Ti", 1024],
]);

/** A CPU quantity in millicores: `500m` is 500, `1` and `0.5` are 1000 and 500. */
export function cpuMillis(text: string): number | undefined {
  const match = cpuQuantity.exec(text);
  if (!match) {
    return undefined;
  }
  const cores = Number(match[1]);
  return Math.round(match[2] ? cores : cores * 1000);
}

/** A memory quantity in mebibytes, such as `512Mi` or `1Gi`. */
export function memoryMiB(text: string): number | undefined {
  const match = memoryQuantity.exec(text);
  const unit = match ? memoryUnits.get(match[2] ?? "") : undefined;
  return match && unit !== undefined ? Number(match[1]) * unit : undefined;
}

/** A disk size in gibibytes, read the way `cluster.diskSize` already is: `300g`. */
function diskGiB(text: string): number | undefined {
  const match = diskQuantity.exec(text);
  const unit = match ? diskUnits.get(match[2] ?? "") : undefined;
  return match && unit !== undefined ? Number(match[1]) * unit : undefined;
}

const parsers: Record<Kind, (text: string) => number | undefined> = {
  cpu: cpuMillis,
  memory: memoryMiB,
  disk: diskGiB,
};

const examples: Record<Kind, string> = {
  cpu: "a CPU quantity such as 500m or 1",
  memory: "a memory quantity such as 512Mi or 1Gi",
  disk: "a size in GiB such as 20g or 20Gi",
};

/** Every reserve the budget reads, named by what it reserves. */
function reserveFields(
  cluster: NonNullable<Environment["cluster"]>,
): ReserveFields {
  const kubelet = cluster.kubelet;
  return {
    kubeCpu: {
      path: "environment.cluster.kubelet.kubeReserved.cpu",
      text: kubelet?.kubeReserved?.cpu,
      kind: "cpu",
    },
    kubeMemory: {
      path: "environment.cluster.kubelet.kubeReserved.memory",
      text: kubelet?.kubeReserved?.memory,
      kind: "memory",
    },
    systemCpu: {
      path: "environment.cluster.kubelet.systemReserved.cpu",
      text: kubelet?.systemReserved?.cpu,
      kind: "cpu",
    },
    systemMemory: {
      path: "environment.cluster.kubelet.systemReserved.memory",
      text: kubelet?.systemReserved?.memory,
      kind: "memory",
    },
    evictionMemory: {
      path: "environment.cluster.kubelet.evictionHard.memory",
      text: kubelet?.evictionHard?.memory,
      kind: "memory",
    },
    disk: {
      path: "environment.cluster.diskReserve",
      text: cluster.diskReserve,
      kind: "disk",
    },
  };
}

/** The reserves as a typed list, in the order the schema lists them. */
function allReserves(fields: ReserveFields): Field[] {
  return [
    fields.kubeCpu,
    fields.kubeMemory,
    fields.systemCpu,
    fields.systemMemory,
    fields.evictionMemory,
    fields.disk,
  ];
}

function readField(field: Field): Reading {
  const value =
    field.text === undefined ? undefined : parsers[field.kind](field.text);
  return { path: field.path, value };
}

/** What is left of `total` once every declared reserve is taken away. */
function remaining(total: number, reserves: Reading[]): number {
  return reserves.reduce((left, reserve) => left - (reserve.value ?? 0), total);
}

/**
 * The budget one node offers, from the declared compute less the kubelet
 * reserves, the eviction floor and the disk reserve. A reserve that is absent
 * or unreadable is named in `missing` and the budget is not judged.
 */
export function nodeBudget(environment: Environment): NodeBudget {
  const cluster = environment.cluster;
  if (cluster === undefined) {
    return { judged: false, missing: ["environment.cluster"] };
  }
  const fields = reserveFields(cluster);
  const kubeCpu = readField(fields.kubeCpu);
  const kubeMemory = readField(fields.kubeMemory);
  const systemCpu = readField(fields.systemCpu);
  const systemMemory = readField(fields.systemMemory);
  const evictionMemory = readField(fields.evictionMemory);
  const disk = readField(fields.disk);
  const diskTotal = diskGiB(cluster.diskSize);

  const readings = [
    kubeCpu,
    kubeMemory,
    systemCpu,
    systemMemory,
    evictionMemory,
    disk,
  ];
  const missing = readings
    .filter((reading) => reading.value === undefined)
    .map((reading) => reading.path);
  if (diskTotal === undefined) {
    missing.push("environment.cluster.diskSize");
  }
  if (missing.length > 0 || diskTotal === undefined) {
    return { judged: false, missing };
  }
  return {
    judged: true,
    nodes: nodeCount(environment),
    perNode: {
      cpuMillis: remaining(cluster.cpus * 1000, [kubeCpu, systemCpu]),
      memoryMiB: remaining(cluster.memoryMB, [
        kubeMemory,
        systemMemory,
        evictionMemory,
      ]),
      diskGiB: remaining(diskTotal, [disk]),
    },
  };
}

const nodeCountHint =
  "environment.nodeCount must be a whole number of at least 1, for example 1 for a single node";
const fractionHint =
  "environment.committedFraction must be a number from 0 to 1, for example 0.8";

function countErrors(environment: Environment): string[] {
  const count = environment.nodeCount;
  if (count === undefined) {
    return [];
  }
  return Number.isInteger(count) && count >= 1 ? [] : [nodeCountHint];
}

function fractionErrors(environment: Environment): string[] {
  const fraction = environment.committedFraction;
  if (fraction === undefined) {
    return [];
  }
  const sound =
    typeof fraction === "number" &&
    Number.isFinite(fraction) &&
    fraction >= 0 &&
    fraction <= 1;
  return sound ? [] : [fractionHint];
}

function quantityErrors(environment: Environment): string[] {
  const cluster = environment.cluster;
  if (cluster === undefined) {
    return [];
  }
  return allReserves(reserveFields(cluster))
    .filter((field) => field.text !== undefined)
    .filter((field) => readField(field).value === undefined)
    .map((field) => `${field.path} must be ${examples[field.kind]}`);
}

function allocatableErrors(environment: Environment): string[] {
  const budget = nodeBudget(environment);
  if (!budget.judged) {
    return [];
  }
  const { perNode } = budget;
  const errors: string[] = [];
  if (perNode.cpuMillis <= 0) {
    errors.push(
      "environment.cluster leaves no allocatable CPU: the kubelet reserves (kubeReserved and systemReserved) are at least cluster.cpus; lower them or raise cluster.cpus",
    );
  }
  if (perNode.memoryMiB <= 0) {
    errors.push(
      "environment.cluster leaves no allocatable memory: the kubelet reserves and eviction floor are at least cluster.memoryMB; lower them or raise cluster.memoryMB",
    );
  }
  if (perNode.diskGiB <= 0) {
    errors.push(
      "environment.cluster leaves no allocatable disk: cluster.diskReserve is at least cluster.diskSize; lower it or raise cluster.diskSize",
    );
  }
  return errors;
}

/**
 * Errors of the node count, the committed fraction and the kubelet and disk
 * reserves, each naming its field and how to fix it. An overlay that declares
 * none of them reports nothing, so every existing overlay still validates.
 */
export function nodeCapacityErrors(environment: Environment): string[] {
  return [
    ...countErrors(environment),
    ...fractionErrors(environment),
    ...quantityErrors(environment),
    ...allocatableErrors(environment),
  ];
}
