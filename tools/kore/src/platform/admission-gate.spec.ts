// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled, isLocalProvider } from "../config/index.js";
import { declaredGateParameters } from "./admission-gate-schema.js";
import {
  admissionGate,
  admissionGateResource,
  admissionGateStatus,
  assertAdmissionGateOpen,
  closeExistingAdmissionGate,
  closedAdmissionGate,
  controllerIdentities,
  ensureClosedAdmissionGate,
  openAdmissionGate,
  platformGeneration,
  readAdmissionGate,
} from "./admission-gate.js";
import {
  appliedParameters,
  commandFailure,
  componentOf,
  failingWith,
  gateJson,
  replyingWith,
  repositoryOf,
  runnerFake,
} from "./gate-unit-support.js";

vi.mock("../config/index.js");
vi.mock("./admission-gate-schema.js");

const repository = repositoryOf({ kubeContext: "k3d-kore-local" }, [
  componentOf("registry", { namespace: "registry-ns" }),
]);
const current = platformGeneration(repository);
const absent = commandFailure(
  'error: the server doesn\'t have a resource type "koreapplicationadmission"',
);

beforeEach(() => {
  vi.mocked(isLocalProvider).mockReturnValue(false);
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(declaredGateParameters).mockResolvedValue(undefined);
});

test("the platform generation is g- and twelve hex digits, and stable for one desired state", () => {
  expect(current).toMatch(/^g-[0-9a-f]{12}$/);
  expect(platformGeneration(repository)).toBe(current);
});

test("the platform generation moves when the environment or a catalog component changes", () => {
  const renamed = repositoryOf(
    { name: "other", kubeContext: "k3d-kore-local" },
    [componentOf("registry", { namespace: "registry-ns" })],
  );
  const moved = repositoryOf({ kubeContext: "k3d-kore-local" }, [
    componentOf("registry", { namespace: "registry-two" }),
  ]);

  expect(platformGeneration(renamed)).not.toBe(current);
  expect(platformGeneration(moved)).not.toBe(current);
});

test("the platform generation moves when a flag gating a component flips", () => {
  const gated = repositoryOf({ kubeContext: "k3d-kore-local" }, [
    componentOf("registry", { featureFlag: "registry" }),
  ]);
  vi.mocked(featureEnabled).mockReturnValue(true);
  const on = platformGeneration(gated);
  vi.mocked(featureEnabled).mockReturnValue(false);

  expect(platformGeneration(gated)).not.toBe(on);
});

test("the gate is dryrun, matches the application kinds, and lists every platform namespace sorted and unique", () => {
  const gate = admissionGate(repository, "closed");

  expect(gate.spec.enforcementAction).toBe("dryrun");
  expect(gate.spec.match.kinds).toContainEqual({
    apiGroups: ["apps", "batch"],
    kinds: expect.arrayContaining(["Deployment", "Job", "CronJob"]),
  });
  expect(gate.spec.parameters.platformNamespaces).toEqual([
    "kube-node-lease",
    "kube-public",
    "kube-system",
    "registry-ns",
  ]);
});

test("the gate names the controllers that keep admitted workloads running while it is closed", () => {
  const gate = closedAdmissionGate(repository);

  expect(gate.spec.parameters.state).toBe("closed");
  expect(gate.spec.parameters.controllerIdentities).toEqual(
    controllerIdentities,
  );
  expect(controllerIdentities).toContain(
    "system:serviceaccount:kube-system:replicaset-controller",
  );
});

test("a local provider adds system:masters to the bootstrap groups, a managed one does not", () => {
  const groups = () => admissionGate(repository, "open").spec.parameters;

  vi.mocked(isLocalProvider).mockReturnValue(true);
  expect(groups().bootstrapGroups).toEqual([
    "kore:bootstrap",
    "system:masters",
  ]);

  vi.mocked(isLocalProvider).mockReturnValue(false);
  expect(groups().bootstrapGroups).toEqual(["kore:bootstrap"]);
});

test("ensuring the gate applies it closed, server-side, under the bootstrap field manager, forcing conflicts", async () => {
  const { run, runner } = runnerFake();

  await ensureClosedAdmissionGate(repository, runner);

  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "apply",
      "--server-side",
      "--field-manager=kore-bootstrap-gate",
      "--force-conflicts",
      "--filename=-",
    ],
    { capture: true, input: expect.any(String) },
  );
  expect(appliedParameters(run).state).toBe("closed");
});

test("a template that predates controllerIdentities never receives the undeclared parameter when closing", async () => {
  vi.mocked(declaredGateParameters).mockResolvedValue(new Set(["generation"]));
  const { run, runner } = runnerFake();

  await ensureClosedAdmissionGate(repository, runner);

  expect(appliedParameters(run)).not.toHaveProperty("controllerIdentities");
});

test("opening is refused, applying nothing, while the template still lacks controllerIdentities", async () => {
  vi.mocked(declaredGateParameters).mockResolvedValue(new Set(["generation"]));
  const { run, runner } = runnerFake();

  await expect(openAdmissionGate(repository, runner)).rejects.toThrow(
    "does not declare controllerIdentities yet",
  );
  expect(run).not.toHaveBeenCalled();
});

test("opening applies the gate open once the template declares controllerIdentities", async () => {
  vi.mocked(declaredGateParameters).mockResolvedValue(
    new Set(["controllerIdentities"]),
  );
  const { run, runner } = runnerFake();

  await openAdmissionGate(repository, runner);

  expect(appliedParameters(run).state).toBe("open");
});

test("reading the gate returns its generation and state, closed when the state is absent", async () => {
  const runner = replyingWith(
    JSON.stringify({ spec: { parameters: { generation: "g-old" } } }),
  ).runner;

  await expect(readAdmissionGate(repository, runner)).resolves.toEqual({
    generation: "g-old",
    state: "closed",
  });
});

test("reading a gate the API server does not know, or a cluster that prints nothing, reports none", async () => {
  await expect(
    readAdmissionGate(repository, failingWith(absent).runner),
  ).resolves.toBe(undefined);
  await expect(
    readAdmissionGate(repository, replyingWith("").runner),
  ).resolves.toBe(undefined);
});

test("reading the gate rethrows failures other than an absent API, and never mutates", async () => {
  const denied = new Error("forbidden");
  const { run, runner } = failingWith(denied);

  await expect(readAdmissionGate(repository, runner)).rejects.toBe(denied);
  expect(run.mock.calls.map(([, args]) => args)).toEqual([
    [
      "--context",
      "k3d-kore-local",
      "get",
      admissionGateResource,
      "kore-application-admission",
      "--ignore-not-found",
      "--output",
      "json",
    ],
  ]);
});

test("closing an existing gate that is open applies the close, and a closed gate of this generation is left alone", async () => {
  const open = replyingWith(gateJson(current, "open"));
  const closed = replyingWith(gateJson(current, "closed"));

  await closeExistingAdmissionGate(repository, open.runner);
  await closeExistingAdmissionGate(repository, closed.runner);

  expect(open.run.mock.calls.some(([, args]) => args.includes("apply"))).toBe(
    true,
  );
  expect(closed.run.mock.calls.some(([, args]) => args.includes("apply"))).toBe(
    false,
  );
});

test("an absent gate is left for the end of the run to create, so closing it applies nothing", async () => {
  const { run, runner } = failingWith(absent);

  await closeExistingAdmissionGate(repository, runner);

  expect(run.mock.calls.some(([, args]) => args.includes("apply"))).toBe(false);
});

test("app admission is refused with the remedy when the gate does not exist", async () => {
  await expect(
    assertAdmissionGateOpen(repository, replyingWith("").runner),
  ).rejects.toThrow(
    "does not exist in k3d-kore-local: the platform has not finished bootstrap",
  );
});

test("app admission is refused as stale when the gate belongs to another generation", async () => {
  await expect(
    assertAdmissionGateOpen(
      repository,
      replyingWith(gateJson("g-other", "open")).runner,
    ),
  ).rejects.toThrow(
    "the application admission gate is stale: it is for platform generation g-other",
  );
});

test("app admission is refused while the gate is closed for this generation, applying nothing", async () => {
  const { run, runner } = replyingWith(gateJson(current, "closed"));

  await expect(assertAdmissionGateOpen(repository, runner)).rejects.toThrow(
    `closed for platform generation ${current}`,
  );
  expect(run.mock.calls.some(([, args]) => args.includes("apply"))).toBe(false);
});

test("app admission proceeds with the current generation when the gate is open", async () => {
  await expect(
    assertAdmissionGateOpen(
      repository,
      replyingWith(gateJson(current, "open")).runner,
    ),
  ).resolves.toBe(current);
});

test("status is ready only for an open gate of the current generation", async () => {
  await expect(
    admissionGateStatus(
      repository,
      replyingWith(gateJson(current, "open")).runner,
    ),
  ).resolves.toEqual({
    name: "application-admission-gate",
    namespace: "cluster",
    status: "ready",
    detail: `open for generation ${current}`,
  });
});

test("status is degraded for a closed or stale gate, and missing when unreadable or absent", async () => {
  const status = (runner: ReturnType<typeof replyingWith>["runner"]) =>
    admissionGateStatus(repository, runner);

  expect(
    (await status(replyingWith(gateJson(current, "closed")).runner)).status,
  ).toBe("degraded");
  expect(
    (await status(replyingWith(gateJson("g-old", "open")).runner)).detail,
  ).toBe(`stale: gate is generation g-old, repository is ${current}`);
  expect(
    await status(failingWith(new Error("connection refused")).runner),
  ).toMatchObject({
    status: "missing",
    detail: "gate could not be read: connection refused",
  });
  expect((await status(replyingWith("").runner)).detail).toBe(
    "gate does not exist",
  );
});
