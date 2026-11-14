import { expect, test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import {
  admissionGateStatus,
  ensureClosedAdmissionGate,
  openAdmissionGate,
  platformGeneration,
  gateCrdJson,
} from "../../src/testing/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { type Call, gateRunner, liveGate } from "./admission-gate-support.js";

const crdName = "koreapplicationadmission.constraints.gatekeeper.sh";

/** A cluster whose generated constraint CRD declares exactly these parameters. */
function schemaRunner(calls: Call[], declared: string[] | undefined): Runner {
  return {
    async run(command, args, options) {
      calls.push({ command, args, input: options?.input });
      if (args.includes("get") && args.includes(`crd/${crdName}`)) {
        return { stdout: gateCrdJson(declared ?? []), stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
}

export const oldParameters = [
  "generation",
  "state",
  "platformNamespaces",
  "bootstrapGroups",
];

export function applied(calls: Call[]): { spec: { parameters: object } }[] {
  return calls
    .filter(({ args }) => args.includes("apply"))
    .map((call) => JSON.parse(call.input ?? "{}"));
}

test("status reports an open gate for the current generation as ready", async () => {
  const repository = await loadRepository("local");
  const generation = platformGeneration(repository);
  const row = await admissionGateStatus(
    repository,
    gateRunner([], liveGate("open", generation)),
  );
  expect(row).toMatchObject({ status: "ready" });
  expect(row.detail).toContain(`open for generation ${generation}`);
});

test("status reports a closed gate, a stale gate, and a missing gate as not ready", async () => {
  const repository = await loadRepository("local");
  const generation = platformGeneration(repository);
  const closed = await admissionGateStatus(
    repository,
    gateRunner([], liveGate("closed", generation)),
  );
  expect(closed).toMatchObject({ status: "degraded" });
  expect(closed.detail).toContain("closed");
  const stale = await admissionGateStatus(
    repository,
    gateRunner([], liveGate("open", "g-000000000000")),
  );
  expect(stale).toMatchObject({ status: "degraded" });
  expect(stale.detail).toMatch(/stale.*g-000000000000/);
  expect(await admissionGateStatus(repository, gateRunner([]))).toMatchObject({
    status: "missing",
  });
});

test("closing the gate on a cluster whose template predates controllerIdentities never sends the undeclared parameter", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];

  await ensureClosedAdmissionGate(
    repository,
    schemaRunner(calls, oldParameters),
  );

  const [gate] = applied(calls);
  expect(gate?.spec.parameters).toMatchObject({ state: "closed" });
  expect(gate?.spec.parameters).not.toHaveProperty("controllerIdentities");
});

test("closing the gate once the template declares controllerIdentities sends it", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];

  await ensureClosedAdmissionGate(
    repository,
    schemaRunner(calls, [...oldParameters, "controllerIdentities"]),
  );

  expect(applied(calls)[0]?.spec.parameters).toHaveProperty(
    "controllerIdentities",
  );
});

test("the schema is read before the constraint is applied, and the read never mutates", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];

  await ensureClosedAdmissionGate(
    repository,
    schemaRunner(calls, oldParameters),
  );

  expect(calls[0]?.args).toContain("get");
  expect(calls[0]?.args).toContain(`crd/${crdName}`);
  expect(calls[1]?.args).toContain("apply");
});

test("opening the gate is refused, applying nothing, while the template still lacks controllerIdentities", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];

  await expect(
    openAdmissionGate(repository, schemaRunner(calls, oldParameters)),
  ).rejects.toThrow(/controllerIdentities.*kore-policy-templates/s);
  expect(applied(calls)).toHaveLength(0);
});

test("a repeated close on an up-to-date cluster applies the identical gate", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  const runner = schemaRunner(calls, [
    ...oldParameters,
    "controllerIdentities",
  ]);

  await ensureClosedAdmissionGate(repository, runner);
  await ensureClosedAdmissionGate(repository, runner);

  const [first, second] = applied(calls);
  expect(second).toEqual(first);
});
