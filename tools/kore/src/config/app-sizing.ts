// The worst-case surge render and judge of one service record (#1525, ADR 0152, ADR 0165). A
// workload's worst case is its requests times its maximum replicas plus one surge pod, for cpu,
// memory and ephemeral storage, and its pods. The service's worst case must fit its suborg's
// quota. The one place that computes it: the ResourceQuota and LimitRange are rendered from the
// same sums the verdict judges. The sum of the suborg quotas against the environment's committed
// share is capacityFit's (capacity-fit.ts); this module does not repeat it. Pure: the caller reads
// the record and its suborg and passes them in.
// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md
// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md

import { cpuMillis, formatCpu, formatMemory, memoryMiB } from "./quantity.js";

/** The CPU request a container gets from the LimitRange when its record declares none (ADR 0152). */
export const defaultCpuRequest = "100m";
/** The autoscaler's minimum when a record declares none; the floor is two. */
export const defaultMinReplicas = 2;
/** The autoscaler's maximum when a record declares none. */
export const defaultMaxReplicas = 5;
/** The fewest replicas a workload may run at, so a rollout keeps one serving. */
const minimumReplicas = 2;
/** The pods a rolling update may add above the maximum: one surge pod. */
const surgePods = 1;

/** One component's sizing fields as written; an absent field is undefined. */
export interface SizedComponent {
  component: string;
  cpu: string | undefined;
  memory: string | undefined;
  memoryLimit?: string | undefined;
  ephemeralStorage?: string | undefined;
  minReplicas?: number | undefined;
  maxReplicas?: number | undefined;
}

/** A service record as the sizing reads it: its file, its name and its components. */
export interface SizedService {
  file: string;
  name: string;
  requests: readonly SizedComponent[];
}

/** A suborg's quota read to amounts: cpu in millicores, memory and ephemeral storage in mebibytes, pods a count. */
export interface SizingQuota {
  name: string;
  file: string;
  cpuMillis: number;
  memoryMiB: number;
  ephemeralMiB: number;
  pods: number;
}

/** The keys the rendered ResourceQuota writes; a key is absent when its amount cannot be read. */
export type QuotaKey =
  "requests.cpu" | "requests.memory" | "requests.ephemeral-storage" | "pods";

export interface SizingRender {
  /** The ResourceQuota the record's worst case needs, as the API server reads it. */
  resourceQuota: { hard: Partial<Record<QuotaKey, string>> };
  /** The LimitRange: a CPU request default only, never a memory default. */
  limitRange: {
    limits: { type: "Container"; defaultRequest: { cpu: string } }[];
  };
  /** Problems that fail kore validate, each naming its field or dimension and the fix. */
  errors: string[];
}

/** One sum over the components: undefined when a component's amount is missing or unreadable. */
interface Totals {
  cpuMillis: number | undefined;
  memoryMiB: number | undefined;
  ephemeralMiB: number | undefined;
  pods: number;
}

/** The replicas a component runs at: its record's bounds, or the defaults where it declares none. */
function replicasOf(component: SizedComponent): { min: number; max: number } {
  return {
    min: component.minReplicas ?? defaultMinReplicas,
    max: component.maxReplicas ?? defaultMaxReplicas,
  };
}

/** The sum of one dimension over the components, undefined when any component's amount is absent. */
function sumOf(values: readonly (number | undefined)[]): number | undefined {
  let total = 0;
  for (const value of values) {
    if (value === undefined) {
      return undefined;
    }
    total += value;
  }
  return total;
}

/**
 * The worst case of the service: each component's requests times its maximum replicas plus one
 * surge pod. An amount the record does not declare, or cannot read, makes its dimension undefined,
 * so it is not judged and the missing field is named by its own check.
 */
function worstCase(service: SizedService): Totals {
  const copies = service.requests.map((component) => {
    const { max } = replicasOf(component);
    const cpu =
      component.cpu === undefined
        ? cpuMillis(defaultCpuRequest)
        : cpuMillis(component.cpu);
    const memory =
      component.memory === undefined ? undefined : memoryMiB(component.memory);
    const ephemeral =
      component.ephemeralStorage === undefined
        ? undefined
        : memoryMiB(component.ephemeralStorage);
    const times = max + surgePods;
    return {
      cpuMillis: cpu === undefined ? undefined : cpu * times,
      memoryMiB: memory === undefined ? undefined : memory * times,
      ephemeralMiB: ephemeral === undefined ? undefined : ephemeral * times,
      pods: times,
    };
  });
  return {
    cpuMillis: sumOf(copies.map((copy) => copy.cpuMillis)),
    memoryMiB: sumOf(copies.map((copy) => copy.memoryMiB)),
    ephemeralMiB: sumOf(copies.map((copy) => copy.ephemeralMiB)),
    pods: copies.reduce((sum, copy) => sum + copy.pods, 0),
  };
}

/** The record's own field checks: memory and ephemeral storage declared, the limit equal to the request, the replica bounds. */
function fieldErrors(service: SizedService): string[] {
  const errors: string[] = [];
  for (const component of service.requests) {
    const base = `${service.file}.spec.components.${component.component}`;
    const requests = `${base}.resources.requests`;
    if (component.memory === undefined) {
      errors.push(
        `${requests}.memory: a memory request is required: declare it, since the memory limit equals it and the quota counts it; nothing is defaulted`,
      );
    }
    if (component.ephemeralStorage === undefined) {
      errors.push(
        `${requests}.ephemeralStorage: an ephemeral storage request is required: declare it, since the quota counts it; nothing is defaulted`,
      );
    } else if (memoryMiB(component.ephemeralStorage) === undefined) {
      errors.push(
        `${requests}.ephemeralStorage: must be a memory quantity such as 1Gi or 512Mi`,
      );
    }
    if (component.memoryLimit !== undefined) {
      const limit = memoryMiB(component.memoryLimit);
      const request =
        component.memory === undefined
          ? undefined
          : memoryMiB(component.memory);
      if (limit === undefined) {
        errors.push(
          `${base}.resources.limits.memory: must be a memory quantity such as 512Mi or 1Gi`,
        );
      } else if (request !== undefined && limit !== request) {
        errors.push(
          `${base}.resources.limits.memory: ${component.memoryLimit} must equal the memory request ${component.memory}: set the limit to the request, or remove it`,
        );
      }
    }
    const { min, max } = replicasOf(component);
    if (component.minReplicas !== undefined && min < minimumReplicas) {
      errors.push(
        `${base}.autoscaling.minReplicas: must be at least ${minimumReplicas}, so a rollout keeps one replica serving; raise it`,
      );
    }
    if (max < min) {
      errors.push(
        `${base}.autoscaling.maxReplicas: ${max} is below minReplicas ${min}; raise maxReplicas or lower minReplicas`,
      );
    }
  }
  return errors;
}

/** The worst case against the suborg's quota, naming each dimension past it. */
function quotaErrors(
  service: SizedService,
  totals: Totals,
  quota: SizingQuota,
): string[] {
  const over: string[] = [];
  if (totals.cpuMillis !== undefined && totals.cpuMillis > quota.cpuMillis) {
    over.push(
      `cpu ${formatCpu(totals.cpuMillis)} requested, quota ${formatCpu(quota.cpuMillis)}`,
    );
  }
  if (totals.memoryMiB !== undefined && totals.memoryMiB > quota.memoryMiB) {
    over.push(
      `memory ${formatMemory(totals.memoryMiB)} requested, quota ${formatMemory(quota.memoryMiB)}`,
    );
  }
  if (
    totals.ephemeralMiB !== undefined &&
    totals.ephemeralMiB > quota.ephemeralMiB
  ) {
    over.push(
      `ephemeral storage ${formatMemory(totals.ephemeralMiB)} requested, quota ${formatMemory(quota.ephemeralMiB)}`,
    );
  }
  if (totals.pods > quota.pods) {
    over.push(`pods ${totals.pods} requested, quota ${quota.pods}`);
  }
  return over.length === 0
    ? []
    : [
        `${service.file}.spec.components: the worst case of ${service.name} (requests times maximum replicas plus one surge pod) exceeds the quota of suborg ${quota.name}: ${over.join("; ")}; lower maxReplicas or a request, or raise spec.quota in ${quota.file}`,
      ];
}

/** The ResourceQuota keys for the dimensions the totals could sum. */
function hardOf(totals: Totals): SizingRender["resourceQuota"]["hard"] {
  const hard: SizingRender["resourceQuota"]["hard"] = {};
  if (totals.cpuMillis !== undefined) {
    hard["requests.cpu"] = formatCpu(totals.cpuMillis);
  }
  if (totals.memoryMiB !== undefined) {
    hard["requests.memory"] = formatMemory(totals.memoryMiB);
  }
  if (totals.ephemeralMiB !== undefined) {
    hard["requests.ephemeral-storage"] = formatMemory(totals.ephemeralMiB);
  }
  hard.pods = String(totals.pods);
  return hard;
}

/**
 * Renders the service's ResourceQuota and LimitRange from its worst case, and judges the record
 * against its suborg quota. A missing or unreadable field is never defaulted: its dimension is
 * left out of the render and of the quota comparison, and the field is named by its own check.
 * With no suborg quota the record's own fields are still judged and nothing is compared.
 */
export function renderSizing(
  service: SizedService,
  quota: SizingQuota | undefined,
): SizingRender {
  const totals = worstCase(service);
  const errors = fieldErrors(service);
  if (quota !== undefined) {
    errors.push(...quotaErrors(service, totals, quota));
  }
  return {
    resourceQuota: { hard: hardOf(totals) },
    limitRange: {
      limits: [
        { type: "Container", defaultRequest: { cpu: defaultCpuRequest } },
      ],
    },
    errors,
  };
}
