import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";

// Enrollment is covered in enrollment.spec.ts and platform.enrollment-order.spec.ts.
vi.mock("./enrollment.js", () => ({
  enrollPlatformNamespaces: async () => undefined,
}));
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

const events = vi.hoisted(() => [] as string[]);
const control = vi.hoisted(() => ({
  failConfiguration: false,
  unready: false,
}));

vi.mock("../cluster/index.js", () => ({
  assertExpectedCluster: async () => undefined,
  ClusterUnavailableError: class extends Error {},
  clusterUp: async () => undefined,
}));
vi.mock("../images/index.js", () => ({
  ensureLocalSigningPublicKey: async () => undefined,
  ensureRegistryAuth: async () => undefined,
  ensureRegistryTrust: async () => undefined,
  registryTrustProblem: async () => undefined,
}));
vi.mock("./registry-rewire.js", () => ({
  rewireRegistryService: async () => false,
}));
vi.mock("./reconcile.js", () => ({
  reconcileIfNeeded: async (_r: unknown, _n: unknown, c: { name: string }) => {
    events.push(`bootstrap:${c.name}`);
  },
  reconcileComponent: async () => undefined,
  reconcileConfiguration: async (
    _r: unknown,
    _n: unknown,
    c: { name: string },
  ) => {
    if (control.failConfiguration) {
      throw new Error(`${c.name} failed`);
    }
    events.push(`configure:${c.name}`);
  },
}));
vi.mock("./status.js", () => ({
  imageInventoryStatusName: "image-inventory",
  platformStatus: async () =>
    control.unready
      ? [
          {
            name: "gatekeeper",
            namespace: "gatekeeper-system",
            status: "degraded",
            detail: "webhook not ready",
          },
        ]
      : [
          {
            name: "gatekeeper",
            namespace: "gatekeeper-system",
            status: "ready",
            detail: "installed and ready",
          },
        ],
}));
vi.mock("../security/index.js", () => ({
  installLocalTrust: async () => undefined,
}));
vi.mock("../tunnel/index.js", () => ({
  startLocalTunnel: async () => undefined,
}));

import { platformGeneration, readAdmissionGate } from "./admission-gate.js";
import { platformUp } from "./up.js";

interface Gate {
  generation: string;
  state: string;
}

/** A cluster that remembers the one gate object kore writes to it. */
function cluster(initial?: Gate) {
  const box: { gate: Gate | undefined } = { gate: initial };
  const runner: Runner = {
    async run(_command, args, options) {
      if (args.includes("apply")) {
        const { parameters } = (
          JSON.parse(options?.input ?? "{}") as { spec: { parameters: Gate } }
        ).spec;
        box.gate = {
          generation: parameters.generation,
          state: parameters.state,
        };
        events.push(`gate:${parameters.state}:${parameters.generation}`);
        return { stdout: "", stderr: "", code: 0 };
      }
      const stdout = box.gate
        ? JSON.stringify({ spec: { parameters: box.gate } })
        : "";
      return { stdout, stderr: "", code: 0 };
    },
  };
  return { box, runner };
}

async function run(
  initial: Gate | undefined,
  mutate?: (r: Awaited<ReturnType<typeof loadRepository>>) => void,
) {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-gate-"));
  const repository = { ...base, root };
  mutate?.(repository);
  const { box, runner } = cluster(initial);
  let error: unknown;
  try {
    await platformUp(repository, runner);
  } catch (caught) {
    error = caught;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  return { box, error, repository, runner };
}

beforeEach(() => {
  events.length = 0;
  control.failConfiguration = false;
  control.unready = false;
});

test("a successful run opens the gate for the current generation, after every phase", async () => {
  const { box, error, repository } = await run(undefined);

  expect(error).toBeUndefined();
  const generation = platformGeneration(repository);
  expect(box.gate).toEqual({ generation, state: "open" });
  const open = events.indexOf(`gate:open:${generation}`);
  expect(open).toBe(events.length - 1);
  expect(open).toBeGreaterThan(
    events.findLastIndex((event) => event.startsWith("configure:")),
  );
  expect(open).toBeGreaterThan(
    events.findLastIndex((event) => event.startsWith("bootstrap:")),
  );
});

test("a run that fails a readiness check leaves the gate closed and fails", async () => {
  control.unready = true;

  const { box, error, repository } = await run(undefined);

  expect(String(error)).toMatch(/gatekeeper.*webhook not ready/s);
  expect(box.gate?.state).not.toBe("open");
  expect(events.filter((event) => event.startsWith("gate:open"))).toEqual([]);
  expect(repository).toBeDefined();
});

test("a run that fails a phase leaves a previously open gate closed", async () => {
  control.failConfiguration = true;
  const base = await loadRepository("local");
  const previous = { generation: platformGeneration(base), state: "open" };

  const { box, error } = await run(previous);

  expect(String(error)).toMatch(/failed/);
  expect(box.gate).toEqual({ ...previous, state: "closed" });
});

test("a rerun after a catalog change closes the gate for the new generation before touching anything, then reopens it", async () => {
  const { box, repository } = await run(
    { generation: "g-000000000000", state: "open" },
    (r) => {
      r.catalog = { ...r.catalog, components: r.catalog.components };
    },
  );

  const generation = platformGeneration(repository);
  const closed = events.indexOf(`gate:closed:${generation}`);
  const firstWork = events.findIndex((event) => event.startsWith("bootstrap:"));
  expect(closed).toBeGreaterThan(-1);
  expect(closed).toBeLessThan(firstWork);
  expect(events.at(-1)).toBe(`gate:open:${generation}`);
  expect(box.gate).toEqual({ generation, state: "open" });
});

test("a run with no earlier gate writes nothing until the foundation is ready", async () => {
  await run(undefined);
  expect(events.findIndex((event) => event.startsWith("gate:"))).toBe(
    events.length - 1,
  );
});

test("readiness is evaluated in the same run as the opening, never from an earlier one", async () => {
  const base = await loadRepository("local");
  const generation = platformGeneration(base);
  control.unready = true;

  const { runner, error } = await run({ generation, state: "open" });

  expect(error).toBeDefined();
  expect((await readAdmissionGate(base, runner))?.state).toBe("closed");
});
