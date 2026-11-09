import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import {
  activationLabel,
  admissionGateStatus,
  assertAdmissionGateOpen,
  closedAdmissionGate,
  ensureClosedAdmissionGate,
  openAdmissionGate,
  platformGeneration,
  readAdmissionGate,
} from "./admission-gate.js";
import { gateCrdJson } from "./admission-gate-support.js";

interface Call {
  command: string;
  args: readonly string[];
  input?: string | undefined;
}

function gateRunner(calls: Call[], gate?: unknown, stderr?: string): Runner {
  return {
    async run(command, args, options) {
      calls.push({ command, args, input: options?.input });
      if (stderr !== undefined) {
        throw new CommandError(command, args, { stdout: "", stderr, code: 1 });
      }
      return {
        stdout: gate === undefined ? "" : JSON.stringify(gate),
        stderr: "",
        code: 0,
      };
    },
  };
}

test("the platform generation is stable for one desired state and differs per environment", async () => {
  const local = await loadRepository("local");
  const managed = await loadRepository("managed-example");
  expect(platformGeneration(local)).toBe(platformGeneration(local));
  expect(platformGeneration(local)).not.toBe(platformGeneration(managed));
  expect(platformGeneration(local)).toMatch(/^g-[0-9a-f]{12}$/);
});

test("the platform generation changes when the catalog changes", async () => {
  const local = await loadRepository("local");
  const changed = {
    ...local,
    catalog: {
      ...local.catalog,
      components: local.catalog.components.slice(1),
    },
  };
  expect(platformGeneration(changed)).not.toBe(platformGeneration(local));
});

test("the gate is born closed for the current generation and exempts every platform namespace", async () => {
  const repository = await loadRepository("local");
  const gate = closedAdmissionGate(repository);
  expect(gate).toMatchObject({
    kind: "KoreApplicationAdmission",
    metadata: { name: "kore-application-admission" },
    spec: {
      parameters: {
        state: "closed",
        generation: platformGeneration(repository),
      },
    },
  });
  const parameters = gate.spec.parameters;
  for (const component of repository.catalog.components) {
    expect(parameters.platformNamespaces).toContain(component.namespace);
  }
  expect(parameters.platformNamespaces).not.toContain("reference");
  expect(parameters.platformNamespaces).not.toContain("default");
  expect(parameters.bootstrapGroups).toContain("kore:bootstrap");
});

test("the gate matches every PodSpec-bearing kind and the claim, and lets only cluster controllers keep admitted workloads running", async () => {
  const gate = closedAdmissionGate(await loadRepository("local"));
  const kinds = gate.spec.match.kinds.flatMap((match) => match.kinds);
  for (const kind of [
    "Pod",
    "ReplicaSet",
    "ReplicationController",
    "Deployment",
    "StatefulSet",
    "DaemonSet",
    "Job",
    "CronJob",
    "PostgreSQLInstance",
    "Namespace",
  ]) {
    expect(kinds).toContain(kind);
  }
  const { controllerIdentities, bootstrapGroups } = gate.spec.parameters;
  expect(controllerIdentities).toContain(
    "system:serviceaccount:kube-system:replicaset-controller",
  );
  // An exemption by identity, never by a group developers can be placed in.
  for (const identity of controllerIdentities) {
    expect(identity).toMatch(/^system:(serviceaccount:kube-system:|kube-)/);
    expect(bootstrapGroups).not.toContain(identity);
  }
});

test("ensuring the gate applies it closed to the configured context under the bootstrap field manager", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];

  await ensureClosedAdmissionGate(repository, gateRunner(calls));

  const applies = calls.filter(({ args }) => args.includes("apply"));
  expect(applies).toHaveLength(1);
  const [call] = applies;
  expect(call?.command).toBe("kubectl");
  expect(call?.args).toEqual([
    "--context",
    repository.environment.kubeContext,
    "apply",
    "--server-side",
    "--field-manager=kore-bootstrap-gate",
    "--force-conflicts",
    "--filename=-",
  ]);
  expect(JSON.parse(call?.input ?? "{}")).toMatchObject({
    spec: { parameters: { state: "closed" } },
  });
});

test("reading an absent gate reports none", async () => {
  const repository = await loadRepository("local");
  expect(await readAdmissionGate(repository, gateRunner([]))).toBeUndefined();
});

test("reading a gate from a cluster without the gate API reports none", async () => {
  const repository = await loadRepository("local");
  const runner = gateRunner(
    [],
    undefined,
    `error: the server doesn't have a resource type "koreapplicationadmission"`,
  );
  expect(await readAdmissionGate(repository, runner)).toBeUndefined();
});

test("reading the gate rethrows unexpected failures", async () => {
  const repository = await loadRepository("local");
  const runner = gateRunner([], undefined, "Unable to connect to the server");
  await expect(readAdmissionGate(repository, runner)).rejects.toThrow(
    /Unable to connect/,
  );
});

function liveGate(state: string, generation: string) {
  return { spec: { parameters: { state, generation } } };
}

test("app admission is refused with the remedy when the gate does not exist", async () => {
  const repository = await loadRepository("local");
  await expect(
    assertAdmissionGateOpen(repository, gateRunner([])),
  ).rejects.toThrow(/gate.*(absent|does not exist).*kore platform up/is);
});

test("app admission is refused while the gate is closed and names its generation", async () => {
  const repository = await loadRepository("local");
  const generation = platformGeneration(repository);
  const runner = gateRunner([], liveGate("closed", generation));
  await expect(assertAdmissionGateOpen(repository, runner)).rejects.toThrow(
    new RegExp(`closed.*${generation}`, "is"),
  );
});

test("app admission is refused when the gate belongs to another generation", async () => {
  const repository = await loadRepository("local");
  const runner = gateRunner([], liveGate("open", "g-000000000000"));
  await expect(assertAdmissionGateOpen(repository, runner)).rejects.toThrow(
    /stale.*g-000000000000.*kore platform up/is,
  );
});

test("app admission proceeds with the current generation when the gate is open", async () => {
  const repository = await loadRepository("local");
  const generation = platformGeneration(repository);
  const runner = gateRunner([], liveGate("open", generation));
  expect(await assertAdmissionGateOpen(repository, runner)).toBe(generation);
});

test("an unrecognised gate state is treated as closed", async () => {
  const repository = await loadRepository("local");
  const generation = platformGeneration(repository);
  const runner = gateRunner([], liveGate("ajar", generation));
  await expect(assertAdmissionGateOpen(repository, runner)).rejects.toThrow(
    /closed/i,
  );
});

test("the activation label is the platform-owned generation label", () => {
  expect(activationLabel).toBe("platform.kore.dev/activation-generation");
});

test("reading the gate never mutates the cluster", async () => {
  const repository = await loadRepository("local");
  const calls: Call[] = [];
  await readAdmissionGate(repository, gateRunner(calls));
  expect(calls[0]?.args).toContain("get");
  expect(calls[0]?.args).toContain("--context");
  expect(calls.flatMap((call) => call.args)).not.toContain("apply");
});

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

const oldParameters = [
  "generation",
  "state",
  "platformNamespaces",
  "bootstrapGroups",
];

function applied(calls: Call[]): { spec: { parameters: object } }[] {
  return calls
    .filter(({ args }) => args.includes("apply"))
    .map((call) => JSON.parse(call.input ?? "{}"));
}

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
