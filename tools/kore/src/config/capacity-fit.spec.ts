import { expect, test } from "vitest";
import {
  capacityFit,
  type CapacityFitInput,
  type PlatformRequests,
} from "./capacity-fit.js";
import type { NodeBudget } from "./node-capacity.js";

/** The platform's summed pod requests, with the inputs it could not read (none unless given). */
const platform = (
  cpuMillis: number,
  memoryMiB = 0,
  missing: string[] = [],
): PlatformRequests => ({ requests: { cpuMillis, memoryMiB }, missing });

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

test("capacityFit takes the platform's requests out of allocatable before the share, so a sum at the reduced share fits", () => {
  expect(
    capacityFit(
      input({
        quotas: [{ cpuMillis: 640, memoryMiB: 0 }],
        platform: platform(200),
      }),
    ),
  ).toEqual({
    status: "fits",
    platformSubtracted: true,
    headroom: { cpuMillis: 0, memoryMiB: 3276 },
  });
});

test("capacityFit refuses a sum one millicore past the share left after the platform's requests", () => {
  expect(
    capacityFit(
      input({
        quotas: [{ cpuMillis: 641, memoryMiB: 0 }],
        platform: platform(200),
      }),
    ),
  ).toEqual({
    status: "over",
    over: [{ dimension: "cpu", requested: 641, allowed: 640 }],
    platformSubtracted: true,
  });
});

test("capacityFit subtracts the platform's memory from allocatable before the memory share", () => {
  const withMemory = (memoryMiB: number) =>
    input({
      quotas: [{ cpuMillis: 0, memoryMiB }],
      platform: platform(0, 1024),
    });
  expect(capacityFit(withMemory(2457))).toMatchObject({
    status: "fits",
    headroom: { memoryMiB: 0 },
  });
  expect(capacityFit(withMemory(2458))).toEqual({
    status: "over",
    over: [{ dimension: "memory", requested: 2458, allowed: 2457 }],
    platformSubtracted: true,
  });
});

test("capacityFit subtracts the platform's requests once from the total over every node", () => {
  const twoNodes = (cpuMillis: number) =>
    input({
      budget: judged(1000, 4096, 2),
      quotas: [{ cpuMillis, memoryMiB: 0 }],
      platform: platform(500),
    });
  expect(capacityFit(twoNodes(1200))).toMatchObject({
    status: "fits",
    headroom: { cpuMillis: 0 },
  });
  expect(capacityFit(twoNodes(1201))).toEqual({
    status: "over",
    over: [{ dimension: "cpu", requested: 1201, allowed: 1200 }],
    platformSubtracted: true,
  });
});

test("capacityFit refuses any suborg quota when the platform's requests fill the whole share", () => {
  expect(
    capacityFit(
      input({
        quotas: [{ cpuMillis: 1, memoryMiB: 0 }],
        platform: platform(1500),
      }),
    ),
  ).toEqual({
    status: "over",
    over: [{ dimension: "cpu", requested: 1, allowed: 0 }],
    platformSubtracted: true,
  });
});

test("capacityFit names the platform's pods it could not size and gives no verdict, even when the sum would fit", () => {
  const unsized =
    "Deployment/kore-gateway-proxy container proxy declares no cpu request";
  expect(
    capacityFit(
      input({
        quotas: [{ cpuMillis: 1, memoryMiB: 1 }],
        platform: platform(0, 0, [unsized]),
      }),
    ),
  ).toEqual({ status: "unjudged", missing: [unsized] });
});

test("capacityFit names the missing reserves and the unsized platform pods together", () => {
  const unsized =
    "DaemonSet/kore-agent container agent declares no memory request";
  expect(
    capacityFit(
      input({
        budget: {
          judged: false,
          missing: ["environment.cluster.kubelet.kubeReserved.cpu"],
        },
        platform: platform(0, 0, [unsized]),
      }),
    ),
  ).toEqual({
    status: "unjudged",
    missing: ["environment.cluster.kubelet.kubeReserved.cpu", unsized],
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

test("capacityFit with no quotas fits and leaves the whole share as headroom", () => {
  expect(capacityFit(input())).toEqual({
    status: "fits",
    platformSubtracted: false,
    headroom: { cpuMillis: 800, memoryMiB: 3276 },
  });
});
