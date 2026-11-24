// The capacity verdict on suborg quotas: the one pure function that judges a sum of quotas
// against an environment's declared budget (ADR 0152, ADR 0165). kore validate calls it with
// the suborg quotas. The worst-case render (#1525) and the platform's own pod requests (#1596)
// import it too and never write a second copy: #1596 supplies `platform`, and the
// subtraction happens here.
// The allowance is a necessary condition: a sum over it cannot fit, whatever else runs. A sum
// under it fits this bound only, so until the platform's requests are subtracted the verdict
// says so (platformSubtracted false) and never reads as a full fit.
// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md

import type { NodeBudget } from "./node-capacity.js";

/** A CPU and memory amount: cpu in millicores, memory in mebibytes. */
export interface Amount {
  cpuMillis: number;
  memoryMiB: number;
}

export type Dimension = "cpu" | "memory";

/** One dimension the sum is over its allowance: what is requested and what may be committed. */
export interface OverDimension {
  dimension: Dimension;
  requested: number;
  allowed: number;
}

/**
 * The platform's own pod requests, summed from its rendered releases (#1596), and the inputs
 * the sum could not read: a pod with no request, or a request it cannot read. Any missing input
 * leaves the budget unjudged; the sum is never taken on a guess.
 */
export interface PlatformRequests {
  requests: Amount;
  missing: readonly string[];
}

export interface CapacityFitInput {
  /** The quotas to sum: the suborgs' quotas, or any other amounts a caller commits. */
  quotas: readonly Amount[];
  /** The environment's node budget. Unjudged, it names the inputs that are missing and gives no verdict. */
  budget: NodeBudget;
  /** The share of the budget that may be committed, from 0 to 1 (ADR 0152). */
  committedFraction: number;
  /** The platform's pod requests, subtracted from allocatable before the share is taken (#1596); unset means not yet subtracted. */
  platform?: PlatformRequests | undefined;
}

export type CapacityFit =
  | { status: "unjudged"; missing: readonly string[] }
  | { status: "over"; over: OverDimension[]; platformSubtracted: boolean }
  | { status: "fits"; platformSubtracted: boolean; headroom: Amount };

/**
 * The most a dimension may commit: what is left of its allocatable amount on every node once the
 * platform's requests are taken out, times the committed share, rounded down. The float product
 * is rounded to six places first, so a bound that is exact in decimal (0.29 of 1000 is 290) is
 * not lost to floating-point error. Platform requests larger than allocatable leave nothing.
 */
function allowance(
  allocatable: number,
  nodes: number,
  platformRequested: number,
  fraction: number,
): number {
  const remaining = Math.max(0, allocatable * nodes - platformRequested);
  return Math.floor(Number((remaining * fraction).toFixed(6)));
}

/**
 * Judges the sum of the quotas against the committed share of the environment's node budget,
 * after the platform's requests come out of allocatable. Unjudged when a reserve is missing or
 * the platform's sum could not be read; over naming each dimension past its share; otherwise
 * fits, with what is left.
 */
export function capacityFit(input: CapacityFitInput): CapacityFit {
  const { quotas, budget, committedFraction, platform } = input;
  const missing = [
    ...(budget.judged ? [] : budget.missing),
    ...(platform?.missing ?? []),
  ];
  if (!budget.judged || missing.length > 0) {
    return { status: "unjudged", missing };
  }
  const { nodes, perNode } = budget;
  const platformRequests = platform?.requests ?? { cpuMillis: 0, memoryMiB: 0 };
  const allowed: Amount = {
    cpuMillis: allowance(
      perNode.cpuMillis,
      nodes,
      platformRequests.cpuMillis,
      committedFraction,
    ),
    memoryMiB: allowance(
      perNode.memoryMiB,
      nodes,
      platformRequests.memoryMiB,
      committedFraction,
    ),
  };
  const requested: Amount = {
    cpuMillis: quotas.reduce((sum, amount) => sum + amount.cpuMillis, 0),
    memoryMiB: quotas.reduce((sum, amount) => sum + amount.memoryMiB, 0),
  };
  const platformSubtracted = platform !== undefined;
  const over: OverDimension[] = [];
  if (requested.cpuMillis > allowed.cpuMillis) {
    over.push({
      dimension: "cpu",
      requested: requested.cpuMillis,
      allowed: allowed.cpuMillis,
    });
  }
  if (requested.memoryMiB > allowed.memoryMiB) {
    over.push({
      dimension: "memory",
      requested: requested.memoryMiB,
      allowed: allowed.memoryMiB,
    });
  }
  if (over.length > 0) {
    return { status: "over", over, platformSubtracted };
  }
  return {
    status: "fits",
    platformSubtracted,
    headroom: {
      cpuMillis: allowed.cpuMillis - requested.cpuMillis,
      memoryMiB: allowed.memoryMiB - requested.memoryMiB,
    },
  };
}
