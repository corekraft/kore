// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { capacityStatus, parseCpu, parseMemory } from "./capacity-status.js";
import { errorMessage } from "./probe.js";

vi.mock("./probe.js");

// Docs: docs/operations/resource-budgets.md

type Run = Runner["run"];

const repository = {
  environment: { kubeContext: "k3d-kore-local" },
} as unknown as Repository;

/** A typed runner answering `get nodes` and `get pods` with the given lists. */
function fakeRunner(nodes: unknown, pods: unknown = { items: [] }) {
  const run = vi.fn<Run>(async (_command, args) => ({
    stdout: JSON.stringify(args.includes("nodes") ? nodes : pods),
    stderr: "",
    code: 0,
  }));
  return { runner: { run } as Runner, run };
}

/** One node with the given allocatable CPU and memory. */
function node(cpu: string, memory: string) {
  return { items: [{ status: { allocatable: { cpu, memory } } }] };
}

/** One container pod with the given requests, in the given phase. */
function pod(cpu: string, memory: string, phase = "Running") {
  return {
    status: { phase },
    spec: { containers: [{ resources: { requests: { cpu, memory } } }] },
  };
}

beforeEach(() => {
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
});

test("a CPU quantity in millicores is read as a fraction of a core, and a whole number as cores", () => {
  expect(parseCpu("250m")).toBe(0.25);
  expect(parseCpu("1500m")).toBe(1.5);
  expect(parseCpu("2")).toBe(2);
});

test("a memory quantity is read in MiB whatever its unit", () => {
  expect(parseMemory("512Mi")).toBe(512);
  expect(parseMemory("1Gi")).toBe(1024);
  expect(parseMemory("2048Ki")).toBe(2);
  expect(parseMemory("1073741824")).toBe(1024);
});

test("a decimal memory unit is read in powers of ten, not powers of two", () => {
  expect(parseMemory("1G")).toBe(954);
});

test("a memory quantity with an unknown unit or no number is rejected naming the quantity", () => {
  expect(() => parseMemory("12Foo")).toThrow(
    "unreadable memory quantity 12Foo",
  );
  expect(() => parseMemory("lots")).toThrow("unreadable memory quantity lots");
});

test("the nodes and pods are read with the environment's context, and pods across every namespace", async () => {
  const { runner, run } = fakeRunner(node("4", "8Gi"));

  await capacityStatus(repository, runner);

  expect(run.mock.calls.map(([, args]) => args)).toEqual([
    ["--context", "k3d-kore-local", "get", "nodes", "--output", "json"],
    [
      "--context",
      "k3d-kore-local",
      "get",
      "pods",
      "--all-namespaces",
      "--output",
      "json",
    ],
  ]);
});

test("requests within the warning share are ready and report both percentages", async () => {
  const { runner } = fakeRunner(node("4", "8Gi"), {
    items: [pod("1", "2Gi")],
  });

  expect(await capacityStatus(repository, runner)).toEqual({
    name: "capacity",
    namespace: "cluster",
    status: "ready",
    detail: "requests are 25% of CPU and 25% of memory (warning at 80%)",
    capacity: {
      cpuRequestedPercent: 25,
      memoryRequestedPercent: 25,
      warningPercent: 80,
    },
  });
});

test("a pod that has Succeeded or Failed no longer holds its requests", async () => {
  const { runner } = fakeRunner(node("4", "8Gi"), {
    items: [
      pod("1", "2Gi", "Succeeded"),
      pod("1", "2Gi", "Failed"),
      pod("1", "2Gi", "Pending"),
    ],
  });

  const row = await capacityStatus(repository, runner);

  expect(row.capacity?.cpuRequestedPercent).toBe(25);
  expect(row.capacity?.memoryRequestedPercent).toBe(25);
});

test("init container requests are excluded: their resources are released before the workload runs", async () => {
  const { runner } = fakeRunner(node("4", "8Gi"), {
    items: [
      {
        status: { phase: "Running" },
        spec: {
          initContainers: [
            { resources: { requests: { cpu: "3", memory: "6Gi" } } },
          ],
          containers: [
            { resources: { requests: { cpu: "1", memory: "2Gi" } } },
          ],
        },
      },
    ],
  });

  const row = await capacityStatus(repository, runner);

  expect(row.capacity?.cpuRequestedPercent).toBe(25);
});

test("CPU requests at the 80% warning share are degraded, and the remedy names cluster.cpus", async () => {
  const { runner } = fakeRunner(node("4", "8Gi"), {
    items: [pod("3200m", "1Gi")],
  });

  expect(await capacityStatus(repository, runner)).toMatchObject({
    status: "degraded",
    detail:
      "CPU requests are 80% of allocatable; raise cluster.cpus in the environment overlay and recreate the profile",
  });
});

test("memory requests at the 80% warning share are degraded, and the remedy names cluster.memoryMB", async () => {
  const { runner } = fakeRunner(node("4", "10Gi"), {
    items: [pod("100m", "8Gi")],
  });

  expect(await capacityStatus(repository, runner)).toMatchObject({
    status: "degraded",
    detail:
      "memory requests are 80% of allocatable; raise cluster.memoryMB in the environment overlay and recreate the profile",
  });
});

test("both warnings are reported together, CPU first, joined by a semicolon", async () => {
  const { runner } = fakeRunner(node("4", "10Gi"), {
    items: [pod("4", "9Gi")],
  });

  const row = await capacityStatus(repository, runner);

  expect(row.detail).toBe(
    "CPU requests are 100% of allocatable; raise cluster.cpus in the environment overlay and recreate the profile; memory requests are 90% of allocatable; raise cluster.memoryMB in the environment overlay and recreate the profile",
  );
});

test("a cluster with no allocatable capacity reports zero percent rather than dividing by zero", async () => {
  const { runner } = fakeRunner({ items: [] }, { items: [pod("1", "1Gi")] });

  const row = await capacityStatus(repository, runner);

  expect(row.capacity?.cpuRequestedPercent).toBe(0);
  expect(row.status).toBe("ready");
});

test("a node quantity that cannot be read is missing, naming the quantity", async () => {
  const { runner } = fakeRunner(node("4", "8 gigs"));

  expect(await capacityStatus(repository, runner)).toEqual({
    name: "capacity",
    namespace: "cluster",
    status: "missing",
    detail: "capacity could not be read: unreadable memory quantity 8 gigs",
  });
});

test("a failed read of the nodes is missing, naming the error", async () => {
  const run = vi.fn<Run>(async () => {
    throw new Error("the server is unreachable");
  });

  expect(
    await capacityStatus(repository, { run } as unknown as Runner),
  ).toEqual({
    name: "capacity",
    namespace: "cluster",
    status: "missing",
    detail: "capacity could not be read: the server is unreachable",
  });
});
