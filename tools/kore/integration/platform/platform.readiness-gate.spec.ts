import { beforeEach, expect, test, vi } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";

// Docs: docs/decisions/0067-platform-readiness-manifest-and-evidence.md

const rowsBox = vi.hoisted(() => ({
  rows: [] as unknown[],
  reads: 0,
}));

vi.mock("../../src/cluster/index.js", () => ({
  assertExpectedCluster: async () => undefined,
  ClusterUnavailableError: class extends Error {},
  clusterUp: async () => undefined,
}));
// The gate reads prerequisite rows from the status module the bootstrap calls
// internally, so that module, not the barrel, is the one to replace here.
vi.mock("../../src/platform/status.js", () => ({
  imageInventoryStatusName: "image-inventory",
  platformStatus: async () => {
    rowsBox.reads += 1;
    return rowsBox.rows;
  },
}));

import { readyRows } from "../../src/testing/index.js";
import {
  closeGateIfDegraded,
  openApplicationAdmission,
  platformGeneration,
  readinessEvidenceName,
} from "../../src/platform/index.js";

interface Written {
  kind: string;
  state?: string;
  evidence?: { state: string; failures: { name: string }[] };
}

/** A cluster that keeps the gate and evidence kore writes, and logs every call. */
function cluster(options: {
  gate?: { generation: string; state: string };
  ignoreGateWrites?: boolean;
  failEvidence?: boolean;
}) {
  const box = {
    gate: options.gate,
    writes: [] as Written[],
    commands: [] as string[][],
  };
  const runner: Runner = {
    async run(command, args, runOptions) {
      box.commands.push([command, ...args]);
      if (args.includes("apply")) {
        const object = JSON.parse(runOptions?.input ?? "{}") as {
          kind: string;
          spec?: { parameters: { generation: string; state: string } };
          data?: Record<string, string>;
        };
        if (object.kind === "ConfigMap") {
          if (options.failEvidence) {
            const { CommandError } = await import("../../src/runtime/index.js");
            throw new CommandError(command, args, {
              stdout: "",
              stderr: "namespaces kore-system not found",
              code: 1,
            });
          }
          box.writes.push({
            kind: "evidence",
            evidence: JSON.parse(object.data?.["evidence.json"] ?? "{}"),
          });
        } else {
          const parameters = object.spec!.parameters;
          box.writes.push({ kind: "gate", state: parameters.state });
          if (!options.ignoreGateWrites) {
            box.gate = {
              generation: parameters.generation,
              state: parameters.state,
            };
          }
        }
        return { stdout: "", stderr: "", code: 0 };
      }
      return {
        stdout: box.gate
          ? JSON.stringify({ spec: { parameters: box.gate } })
          : "",
        stderr: "",
        code: 0,
      };
    },
  };
  return { box, runner };
}

beforeEach(() => {
  rowsBox.reads = 0;
});

test("opening records the evidence first and then opens the gate, which is read back as open", async () => {
  const repository = await loadRepository("local");
  rowsBox.rows = readyRows(repository);
  const { box, runner } = cluster({});

  await openApplicationAdmission(repository, runner);

  expect(box.writes.map(({ kind, state }) => state ?? kind)).toEqual([
    "evidence",
    "open",
  ]);
  expect(box.writes[0]?.evidence?.state).toBe("open");
  expect(box.gate).toEqual({
    generation: platformGeneration(repository),
    state: "open",
  });
});

test("a failed prerequisite keeps the gate closed, records closed evidence naming it, and fails", async () => {
  const repository = await loadRepository("local");
  rowsBox.rows = readyRows(repository).map((row) =>
    row.name === "policy-controller"
      ? { ...row, status: "degraded", detail: "webhook has no endpoints" }
      : row,
  );
  const { box, runner } = cluster({
    gate: { generation: platformGeneration(repository), state: "open" },
  });

  await expect(openApplicationAdmission(repository, runner)).rejects.toThrow(
    /stays closed: image-trust: policy-controller \(webhook has no endpoints\)/,
  );
  expect(box.gate?.state).toBe("closed");
  expect(box.writes.at(-1)?.kind).toBe("evidence");
  expect(box.writes.at(-1)?.evidence?.failures.map(({ name }) => name)).toEqual(
    ["policy-controller"],
  );
});

test("the gate is closed before closed evidence is recorded, so evidence trouble cannot leave it open", async () => {
  const repository = await loadRepository("local");
  rowsBox.rows = readyRows(repository).slice(1);
  const { box, runner } = cluster({
    gate: { generation: platformGeneration(repository), state: "open" },
    failEvidence: true,
  });

  await expect(openApplicationAdmission(repository, runner)).rejects.toThrow(
    /stays closed/,
  );
  expect(box.gate?.state).toBe("closed");
});

test("if evidence cannot be recorded the gate is never opened", async () => {
  const repository = await loadRepository("local");
  rowsBox.rows = readyRows(repository);
  const { box, runner } = cluster({ failEvidence: true });

  await expect(openApplicationAdmission(repository, runner)).rejects.toThrow(
    /kore-system not found/,
  );
  expect(box.writes.some(({ state }) => state === "open")).toBe(false);
  expect(box.gate).toBeUndefined();
});

test("success is not reported when the gate reads back as anything but open for this generation", async () => {
  const repository = await loadRepository("local");
  rowsBox.rows = readyRows(repository);
  const { runner } = cluster({ ignoreGateWrites: true });

  await expect(openApplicationAdmission(repository, runner)).rejects.toThrow(
    /does not exist|closed|stale/,
  );
});

test("an open gate whose prerequisite became unhealthy is closed, naming the failure, and nothing else is touched", async () => {
  const repository = await loadRepository("local");
  rowsBox.rows = readyRows(repository).map((row) =>
    row.name === "otel-collector"
      ? {
          ...row,
          status: "degraded",
          detail: "Deployment has no available replica",
        }
      : row,
  );
  const { box, runner } = cluster({
    gate: { generation: platformGeneration(repository), state: "open" },
  });

  const result = await closeGateIfDegraded(repository, runner);

  expect(result.closed).toBe(true);
  expect(result.failures.map(({ name }) => name)).toEqual(["otel-collector"]);
  expect(box.gate?.state).toBe("closed");
  // Only the gate and its evidence are written: no scaling, rollout, delete or
  // eviction, so running workloads continue untouched.
  const mutating = box.commands.filter(([, , , verb]) => verb !== "get");
  for (const command of mutating) {
    expect(command).toContain("apply");
    expect(command).toContain("--server-side");
  }
  expect(
    box.commands
      .flat()
      .some((arg) => /delete|scale|rollout|drain|evict/.test(arg)),
  ).toBe(false);
});

test("healthy prerequisites leave the gate untouched: checking can close the gate but never opens it", async () => {
  const repository = await loadRepository("local");
  rowsBox.rows = readyRows(repository);
  const closedGate = {
    generation: platformGeneration(repository),
    state: "closed",
  };
  const { box, runner } = cluster({ gate: closedGate });

  const result = await closeGateIfDegraded(repository, runner);

  expect(result).toMatchObject({ closed: false, failures: [] });
  expect(box.writes).toEqual([]);
  expect(box.gate).toEqual(closedGate);
});

test("a missing gate needs no closing", async () => {
  const repository = await loadRepository("local");
  rowsBox.rows = readyRows(repository).slice(1);
  const { box, runner } = cluster({});

  const result = await closeGateIfDegraded(repository, runner);

  expect(result.closed).toBe(false);
  expect(result.failures.length).toBeGreaterThan(0);
  expect(box.writes).toEqual([]);
});

test("the evidence object's name is the one the chart grants to bootstrap only", () => {
  expect(readinessEvidenceName).toBe("kore-platform-readiness");
});
