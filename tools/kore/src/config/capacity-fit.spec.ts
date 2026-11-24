import { expect, test } from "vitest";
import { capacityFit, type CapacityFitInput } from "./capacity-fit.js";
import type { NodeBudget } from "./node-capacity.js";

/** A judged budget for one node unless nodes says more: 1000m and 4096Mi allocatable per node. */
const judged = (
  cpuMillis: number,
  memoryMiB: number,
  nodes = 1,
): NodeBudget => ({
  judged: true,
  nodes,
  perNode: { cpuMillis, memoryMiB, diskGiB: 100 },
});

const input = (over: Partial<CapacityFitInput> = {}): CapacityFitInput => ({
  quotas: [],
  budget: judged(1000, 4096),
  committedFraction: 0.8,
  ...over,
});

test("capacityFit gives no verdict and names the missing inputs when the budget is not judged", () => {
  const budget: NodeBudget = {
    judged: false,
    missing: ["environment.cluster.kubelet.kubeReserved.cpu"],
  };
  expect(
    capacityFit(input({ budget, quotas: [{ cpuMillis: 1, memoryMiB: 1 }] })),
  ).toEqual({
    status: "unjudged",
    missing: ["environment.cluster.kubelet.kubeReserved.cpu"],
  });
});

test("capacityFit fits quotas inside the committed share and reports the headroom left", () => {
  expect(
    capacityFit(input({ quotas: [{ cpuMillis: 500, memoryMiB: 2048 }] })),
  ).toEqual({
    status: "fits",
    platformSubtracted: false,
    headroom: { cpuMillis: 300, memoryMiB: 1228 },
  });
});

test("capacityFit scales the allowance by the node count", () => {
  expect(
    capacityFit(
      input({
        budget: judged(1000, 4096, 2),
        quotas: [{ cpuMillis: 1500, memoryMiB: 0 }],
      }),
    ),
  ).toEqual({
    status: "fits",
    platformSubtracted: false,
    headroom: { cpuMillis: 100, memoryMiB: 6553 },
  });
});

test("capacityFit refuses a cpu sum over the share, naming the request and the allowance", () => {
  expect(
    capacityFit(input({ quotas: [{ cpuMillis: 1700, memoryMiB: 0 }] })),
  ).toEqual({
    status: "over",
    over: [{ dimension: "cpu", requested: 1700, allowed: 800 }],
    platformSubtracted: false,
  });
});

test("capacityFit names every dimension over its share, not only the first", () => {
  expect(
    capacityFit(input({ quotas: [{ cpuMillis: 900, memoryMiB: 5000 }] })),
  ).toEqual({
    status: "over",
    over: [
      { dimension: "cpu", requested: 900, allowed: 800 },
      { dimension: "memory", requested: 5000, allowed: 3276 },
    ],
    platformSubtracted: false,
  });
});

test("capacityFit allows a sum exactly at the share, leaving no headroom", () => {
  expect(
    capacityFit(input({ quotas: [{ cpuMillis: 800, memoryMiB: 3276 }] })),
  ).toEqual({
    status: "fits",
    platformSubtracted: false,
    headroom: { cpuMillis: 0, memoryMiB: 0 },
  });
});

test("capacityFit keeps a bound that is exact in decimal despite floating-point error", () => {
  const exact = input({
    budget: judged(1000, 1000),
    committedFraction: 0.29,
    quotas: [{ cpuMillis: 290, memoryMiB: 0 }],
  });
  expect(capacityFit(exact)).toMatchObject({
    status: "fits",
    headroom: { cpuMillis: 0 },
  });
});

test("capacityFit counts the platform's requests against the share when they are given", () => {
  expect(
    capacityFit(
      input({
        quotas: [{ cpuMillis: 500, memoryMiB: 0 }],
        platform: { cpuMillis: 400, memoryMiB: 0 },
      }),
    ),
  ).toEqual({
    status: "over",
    over: [{ dimension: "cpu", requested: 900, allowed: 800 }],
    platformSubtracted: true,
  });
});

test("capacityFit says the platform's requests were not subtracted when none are given", () => {
  expect(
    capacityFit(input({ quotas: [{ cpuMillis: 100, memoryMiB: 0 }] })),
  ).toMatchObject({
    status: "fits",
    platformSubtracted: false,
  });
});

test("capacityFit refuses platform requests alone over the share, with no quota at all", () => {
  expect(
    capacityFit(input({ platform: { cpuMillis: 900, memoryMiB: 0 } })),
  ).toEqual({
    status: "over",
    over: [{ dimension: "cpu", requested: 900, allowed: 800 }],
    platformSubtracted: true,
  });
});

test("capacityFit with no quotas fits and leaves the whole share as headroom", () => {
  expect(capacityFit(input())).toEqual({
    status: "fits",
    platformSubtracted: false,
    headroom: { cpuMillis: 800, memoryMiB: 3276 },
  });
});
