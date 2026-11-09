import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  capacityStatus,
  capacityWarningPercent,
  parseCpu,
  parseMemory,
} from "./capacity-status.js";
import { platformStatusReport } from "./crd-ownership-status.js";

// Docs: docs/operations/resource-budgets.md
// The local profile warns before node requests exhaust allocatable CPU or
// memory. The check is read-only and audit-only: it never fails `platform up`.

function pod(
  phase: string,
  ...requests: { cpu?: string; memory?: string }[]
): unknown {
  return {
    status: { phase },
    spec: {
      containers: requests.map((r) => ({ resources: { requests: r } })),
      initContainers: [{ resources: { requests: { cpu: "64" } } }],
    },
  };
}

function cluster(nodes: object | Error, pods: unknown[] = []) {
  const calls: string[][] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push([command, ...args]);
      if (nodes instanceof Error) {
        throw nodes;
      }
      const resource = args[args.indexOf("get") + 1];
      return {
        stdout: JSON.stringify(resource === "nodes" ? nodes : { items: pods }),
        stderr: "",
        code: 0,
      };
    },
  };
  return { runner, calls };
}

const node = {
  items: [{ status: { allocatable: { cpu: "4", memory: "8000Mi" } } }],
};

test("quantities parse in the units Kubernetes reports", () => {
  assert.equal(parseCpu("250m"), 0.25);
  assert.equal(parseCpu("2"), 2);
  assert.equal(parseMemory("1Gi"), 1024);
  assert.equal(parseMemory("512Mi"), 512);
  assert.equal(parseMemory("1048576Ki"), 1024);
  assert.equal(parseMemory("1073741824"), 1024);
  assert.equal(parseMemory("1G"), Math.round(1e9 / 1048576));
});

test("requests under the threshold are ready and report the percentages", async () => {
  const repository = await loadRepository("local");
  const { runner } = cluster(node, [
    pod("Running", { cpu: "1", memory: "2000Mi" }),
  ]);

  const result = await capacityStatus(repository, runner);

  assert.equal(result.status, "ready", result.detail);
  assert.deepEqual(result.capacity, {
    cpuRequestedPercent: 25,
    memoryRequestedPercent: 25,
    warningPercent: capacityWarningPercent,
  });
});

test("CPU requests at the threshold are degraded and name the remedy", async () => {
  const repository = await loadRepository("local");
  const { runner } = cluster(node, [pod("Running", { cpu: "3500m" })]);

  const result = await capacityStatus(repository, runner);

  assert.equal(result.status, "degraded");
  assert.match(result.detail, /CPU requests are 88%/);
  assert.match(result.detail, /cluster\.cpus/);
});

test("memory requests over the threshold are degraded and name the remedy", async () => {
  const repository = await loadRepository("local");
  const { runner } = cluster(node, [pod("Running", { memory: "7000Mi" })]);

  const result = await capacityStatus(repository, runner);

  assert.equal(result.status, "degraded");
  assert.match(result.detail, /memory requests are 88%/);
  assert.match(result.detail, /cluster\.memoryMB/);
});

test("finished pods and init containers do not count toward requests", async () => {
  const repository = await loadRepository("local");
  const { runner } = cluster(node, [
    pod("Succeeded", { cpu: "4" }),
    pod("Failed", { cpu: "4" }),
    pod("Running", { cpu: "100m" }),
  ]);

  const result = await capacityStatus(repository, runner);

  assert.equal(result.status, "ready", result.detail);
});

test("an unreachable cluster is missing, not ready", async () => {
  const repository = await loadRepository("local");
  const { runner } = cluster(new Error("connection refused"));

  const result = await capacityStatus(repository, runner);

  assert.equal(result.status, "missing");
  assert.match(result.detail, /connection refused/);
});

test("the check only reads, through the configured context", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = cluster(node, []);

  await capacityStatus(repository, runner);

  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call[0], "kubectl");
    assert.deepEqual(call.slice(1, 3), [
      "--context",
      repository.environment.kubeContext,
    ]);
    assert.ok(call.includes("get"));
    assert.ok(!call.some((arg) => /^(apply|delete|patch|create)$/.test(arg)));
  }
});

test("the platform status report includes the capacity row only when unfiltered", async () => {
  const repository = await loadRepository("local");
  repository.catalog.components = [];
  const { runner } = cluster(node, []);

  const rows = await platformStatusReport(repository, runner);
  assert.ok(rows.some((row) => row.name === "capacity"));

  const filtered = await platformStatusReport(repository, runner, ["x"]);
  assert.ok(!filtered.some((row) => row.name === "capacity"));
});
