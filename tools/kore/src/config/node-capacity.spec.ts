// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md
import { expect, test } from "vitest";
import { fakeEnvironment, malformed } from "./config-support.js";
import {
  DEFAULT_COMMITTED_FRACTION,
  DEFAULT_NODE_COUNT,
  committedFraction,
  nodeBudget,
  nodeCapacityErrors,
  nodeCount,
} from "./node-capacity.js";
import type { Environment } from "./types.js";

const cluster = {
  profile: "external",
  kubernetesVersion: "1.37.2",
  driver: "external",
  containerRuntime: "containerd",
  cpus: 4,
  memoryMB: 20480,
  diskSize: "300g",
};

const reserved = {
  kubelet: {
    kubeReserved: { cpu: "500m", memory: "1Gi" },
    systemReserved: { cpu: "250m", memory: "512Mi" },
    evictionHard: { memory: "1Gi" },
  },
  diskReserve: "20g",
};

function managed(fields: Partial<NonNullable<Environment["cluster"]>> = {}) {
  return fakeEnvironment({
    name: "vps",
    provider: "managed",
    cluster: { ...cluster, ...fields } as NonNullable<Environment["cluster"]>,
  });
}

test("an overlay that declares no node count reads one node, the default for every existing overlay", () => {
  expect(DEFAULT_NODE_COUNT).toBe(1);
  expect(nodeCount(fakeEnvironment())).toBe(1);
});

test("an overlay that declares a node count reads the declared value", () => {
  expect(nodeCount(fakeEnvironment({ nodeCount: 3 }))).toBe(3);
});

test("an overlay that declares no committed fraction reads 0.8, the owner's default", () => {
  expect(DEFAULT_COMMITTED_FRACTION).toBe(0.8);
  expect(committedFraction(fakeEnvironment())).toBe(0.8);
});

test("an overlay that declares a committed fraction reads the declared value", () => {
  expect(committedFraction(fakeEnvironment({ committedFraction: 0.5 }))).toBe(
    0.5,
  );
});

test("an overlay with a sound node count and fraction reports no capacity error", () => {
  expect(
    nodeCapacityErrors(
      fakeEnvironment({ nodeCount: 1, committedFraction: 0.8 }),
    ),
  ).toEqual([]);
});

test("an overlay that declares neither field reports no capacity error, so every existing overlay still validates", () => {
  expect(nodeCapacityErrors(fakeEnvironment())).toEqual([]);
});

test("a node count below one is refused, naming the field and how to fix it", () => {
  expect(nodeCapacityErrors(fakeEnvironment({ nodeCount: 0 }))).toEqual([
    "environment.nodeCount must be a whole number of at least 1, for example 1 for a single node",
  ]);
});

test("a node count that is not a whole number is refused under the same field name", () => {
  expect(nodeCapacityErrors(fakeEnvironment({ nodeCount: 1.5 }))).toEqual([
    "environment.nodeCount must be a whole number of at least 1, for example 1 for a single node",
  ]);
});

test("a committed fraction above one or below zero is refused, naming the field and its range", () => {
  const message =
    "environment.committedFraction must be a number from 0 to 1, for example 0.8";
  expect(
    nodeCapacityErrors(fakeEnvironment({ committedFraction: 1.2 })),
  ).toEqual([message]);
  expect(
    nodeCapacityErrors(fakeEnvironment({ committedFraction: -0.1 })),
  ).toEqual([message]);
});

test("the committed fraction's bounds are inclusive: zero and one are accepted", () => {
  expect(nodeCapacityErrors(fakeEnvironment({ committedFraction: 0 }))).toEqual(
    [],
  );
  expect(nodeCapacityErrors(fakeEnvironment({ committedFraction: 1 }))).toEqual(
    [],
  );
});

test("a committed fraction written as text is refused rather than read as a number", () => {
  const malformedFraction = malformed<number>("0.8");
  expect(
    nodeCapacityErrors(
      fakeEnvironment({ committedFraction: malformedFraction }),
    ),
  ).toEqual([
    "environment.committedFraction must be a number from 0 to 1, for example 0.8",
  ]);
});

test("a kubelet reserve that is not a Kubernetes quantity is refused, naming the exact field", () => {
  const environment = managed({
    kubelet: {
      kubeReserved: { cpu: "fast", memory: "1Gi" },
      systemReserved: { cpu: "250m", memory: "512Mi" },
      evictionHard: { memory: "1Gi" },
    },
  });
  expect(nodeCapacityErrors(environment)).toEqual([
    "environment.cluster.kubelet.kubeReserved.cpu must be a CPU quantity such as 500m or 1",
  ]);
});

test("a disk reserve that is not a size is refused, naming the field and an example", () => {
  const environment = managed({ diskReserve: "twenty" });
  expect(nodeCapacityErrors(environment)).toEqual([
    "environment.cluster.diskReserve must be a size in GiB such as 20g or 20Gi",
  ]);
});

test("sound reserves and a disk reserve report no capacity error", () => {
  expect(nodeCapacityErrors(managed(reserved))).toEqual([]);
});

test("reserves that leave no allocatable CPU are refused and name the reserve to lower", () => {
  const environment = managed({
    cpus: 1,
    kubelet: {
      kubeReserved: { cpu: "1", memory: "1Gi" },
      systemReserved: { cpu: "250m", memory: "512Mi" },
      evictionHard: { memory: "1Gi" },
    },
    diskReserve: "20g",
  });
  expect(nodeCapacityErrors(environment)).toEqual([
    "environment.cluster leaves no allocatable CPU: the kubelet reserves (kubeReserved and systemReserved) are at least cluster.cpus; lower them or raise cluster.cpus",
  ]);
});

test("a budget with no reserves declared is not judged and names every missing reserve", () => {
  expect(nodeBudget(managed())).toEqual({
    judged: false,
    missing: [
      "environment.cluster.kubelet.kubeReserved.cpu",
      "environment.cluster.kubelet.kubeReserved.memory",
      "environment.cluster.kubelet.systemReserved.cpu",
      "environment.cluster.kubelet.systemReserved.memory",
      "environment.cluster.kubelet.evictionHard.memory",
      "environment.cluster.diskReserve",
    ],
  });
});

test("a budget with one reserve absent is not judged, and names only the reserve that is absent", () => {
  const environment = managed({
    ...reserved,
    kubelet: {
      kubeReserved: reserved.kubelet.kubeReserved,
      systemReserved: reserved.kubelet.systemReserved,
    },
  });
  expect(nodeBudget(environment)).toEqual({
    judged: false,
    missing: ["environment.cluster.kubelet.evictionHard.memory"],
  });
});

test("an environment with no cluster settings, such as a k3d overlay, has no budget to judge", () => {
  expect(
    nodeBudget(fakeEnvironment({ name: "local", provider: "k3d" })),
  ).toEqual({ judged: false, missing: ["environment.cluster"] });
});

test("allocatable is the declared compute less the kubelet reserves and eviction floor, per node", () => {
  expect(nodeBudget(managed(reserved))).toEqual({
    judged: true,
    nodes: 1,
    perNode: {
      cpuMillis: 4000 - 500 - 250,
      memoryMiB: 20480 - 1024 - 512 - 1024,
      diskGiB: 300 - 20,
    },
  });
});

test("the budget reports the declared node count alongside the per-node allocatable", () => {
  const environment = managed(reserved);
  expect(nodeBudget({ ...environment, nodeCount: 2 })).toMatchObject({
    judged: true,
    nodes: 2,
  });
});

test("a memory reserve given in mebibytes or in gibibytes is read in the same unit", () => {
  const environment = managed({
    ...reserved,
    kubelet: {
      kubeReserved: { cpu: "500m", memory: "2048Mi" },
      systemReserved: { cpu: "250m", memory: "1Gi" },
      evictionHard: { memory: "512Mi" },
    },
  });
  expect(nodeBudget(environment)).toMatchObject({
    judged: true,
    perNode: { memoryMiB: 20480 - 2048 - 1024 - 512 },
  });
});

test("a CPU reserve given as a whole number of cores is read as thousands of millicores", () => {
  const environment = managed({
    ...reserved,
    kubelet: {
      kubeReserved: { cpu: "1", memory: "1Gi" },
      systemReserved: { cpu: "0.5", memory: "512Mi" },
      evictionHard: { memory: "1Gi" },
    },
  });
  expect(nodeBudget(environment)).toMatchObject({
    judged: true,
    perNode: { cpuMillis: 4000 - 1000 - 500 },
  });
});
