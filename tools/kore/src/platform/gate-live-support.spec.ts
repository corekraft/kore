// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { admissionGate, type AdmissionGate } from "./admission-gate.js";
import {
  bootstrap,
  canI,
  developer,
  kubectl,
  replicaSetController,
  type Live,
} from "./gate-live.js";
import {
  grantProofGateAccess,
  revokeProofGateAccess,
} from "./gate-proof-access.js";
import {
  assertClosedDenies,
  assertRbac,
  dryRun,
  dryRunUntil,
  proofConstraint,
  proveAdmission,
  setProofGate,
  workload,
  type Proof,
} from "./gate-live-support.js";
import { repositoryOf, runnerFake } from "./gate-unit-support.js";

vi.mock("./admission-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admission-gate.js")>()),
  admissionGate: vi.fn(),
}));
vi.mock("./gate-live.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gate-live.js")>()),
  canI: vi.fn(),
  kubectl: vi.fn(),
}));
vi.mock("./gate-proof-access.js", () => ({
  grantProofGateAccess: vi.fn(),
  revokeProofGateAccess: vi.fn(),
}));

const cluster: Live = {
  repository: repositoryOf({ kubeContext: "k3d-kore-local" }),
  runner: runnerFake().runner,
};
const proof: Proof = {
  cluster,
  namespace: "kore-gate-proof-1",
  constraint: "kore-gate-proof-1",
  image: "registry.local/app:1",
};
const closedMessage = "application admission gate is closed for generation";
const refused = { ok: false, output: closedMessage };

function gateFake(state: "closed" | "open"): AdmissionGate {
  return {
    apiVersion: "constraints.gatekeeper.sh/v1beta1",
    kind: "KoreApplicationAdmission",
    metadata: { name: "kore-application-admission" },
    spec: {
      enforcementAction: "dryrun",
      match: { kinds: [] },
      parameters: {
        generation: "g-real",
        state,
        platformNamespaces: ["kube-system"],
        bootstrapGroups: ["kore:bootstrap"],
        controllerIdentities: [],
      },
    },
  };
}

beforeEach(() => {
  vi.mocked(admissionGate).mockReturnValue(gateFake("closed"));
  vi.mocked(kubectl).mockResolvedValue({ ok: true, output: "" });
  vi.mocked(grantProofGateAccess).mockResolvedValue(undefined);
  vi.mocked(revokeProofGateAccess).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

test("the RBAC proof passes when developers are refused and bootstrap may only patch the platform gate", async () => {
  vi.mocked(canI).mockImplementation(
    async (_cluster, identity, request) =>
      identity === bootstrap &&
      request[0] === "patch" &&
      !request.some((part) => part.endsWith("-other")),
  );

  await expect(assertRbac(cluster)).resolves.toBeUndefined();
});

test("the RBAC proof fails naming the request a developer can still make", async () => {
  vi.mocked(canI).mockResolvedValue(true);

  await expect(assertRbac(cluster)).rejects.toThrow(
    "a developer must not be able to update",
  );
});

test("the RBAC proof fails when bootstrap can delete the readiness evidence", async () => {
  vi.mocked(canI).mockImplementation(
    async (_cluster, identity, request) =>
      identity === bootstrap &&
      (request[0] === "patch" || request[0] === "delete") &&
      !request.some((part) => part.endsWith("-other")),
  );

  await expect(assertRbac(cluster)).rejects.toThrow(
    "nobody is granted delete on the readiness evidence",
  );
});

test("a workload is a Pod or a Deployment whose one container runs the image", () => {
  const pod: { kind: string; spec: { containers: { image: string }[] } } =
    JSON.parse(workload("app", "img:1", "Pod"));
  const deployment: {
    apiVersion: string;
    spec: { template: { spec: { containers: { image: string }[] } } };
  } = JSON.parse(workload("app", "img:1", "Deployment"));

  expect(pod.kind).toBe("Pod");
  expect(pod.spec.containers[0]?.image).toBe("img:1");
  expect(deployment.apiVersion).toBe("apps/v1");
  expect(deployment.spec.template.spec.containers[0]?.image).toBe("img:1");
});

test("the proof constraint denies only its own namespace and takes a generation no platform namespace shares", () => {
  vi.mocked(admissionGate).mockReturnValue(gateFake("closed"));

  const body: {
    metadata: { name: string };
    spec: {
      enforcementAction: string;
      match: { namespaces: string[] };
      parameters: { generation: string };
    };
  } = JSON.parse(proofConstraint(proof, "closed"));

  expect(admissionGate).toHaveBeenCalledWith(cluster.repository, "closed");
  expect(body.metadata.name).toBe("kore-gate-proof-1");
  expect(body.spec.enforcementAction).toBe("deny");
  expect(body.spec.match.namespaces).toEqual(["kore-gate-proof-1"]);
  expect(body.spec.parameters.generation).toBe("g-proofproof00");
});

test("setting the proof gate applies the constraint as bootstrap, and a refused apply stops the proof", async () => {
  await setProofGate(proof, "open");

  expect(kubectl).toHaveBeenCalledWith(
    cluster,
    [
      ...bootstrap,
      "apply",
      "--server-side",
      "--field-manager=kore-bootstrap-gate",
      "--force-conflicts",
      "--filename=-",
    ],
    expect.any(String),
  );

  vi.mocked(kubectl).mockResolvedValue({ ok: false, output: "forbidden" });
  await expect(setProofGate(proof, "closed")).rejects.toThrow(
    "bootstrap sets the proof gate closed: forbidden",
  );
});

test("a dry run asks the server as the identity, for the kind and image of the proof", async () => {
  await dryRun(proof, developer, "Deployment");

  expect(kubectl).toHaveBeenCalledWith(
    cluster,
    [...developer, "create", "--dry-run=server", "--filename=-"],
    workload("kore-gate-proof-1", "registry.local/app:1", "Deployment"),
  );
});

test("a verdict that already matches is returned at once, without a second look", async () => {
  vi.mocked(kubectl).mockResolvedValue(refused);

  await expect(dryRunUntil(proof, "Deployment", true)).resolves.toEqual(
    refused,
  );
  expect(kubectl).toHaveBeenCalledTimes(1);
});

test("a stale verdict is looked at again every two seconds until it changes", async () => {
  vi.useFakeTimers();
  vi.mocked(kubectl)
    .mockResolvedValueOnce({ ok: true, output: "" })
    .mockResolvedValueOnce(refused);

  const pending = dryRunUntil(proof, "Deployment", true);
  await vi.advanceTimersByTimeAsync(2000);

  await expect(pending).resolves.toEqual(refused);
  expect(kubectl).toHaveBeenCalledTimes(2);
});

test("a verdict that never changes gives up after 30 looks and returns the last one", async () => {
  vi.useFakeTimers();
  vi.mocked(kubectl).mockResolvedValue({ ok: true, output: "" });

  const pending = dryRunUntil(proof, "Deployment", true);
  await vi.advanceTimersByTimeAsync(60_000);

  await expect(pending).resolves.toEqual({ ok: true, output: "" });
  expect(kubectl).toHaveBeenCalledTimes(31);
});

test("a closed gate denies the Deployment and the Pod, refuses a developer's open, and spares the controller", async () => {
  vi.mocked(kubectl).mockImplementation(async (_cluster, args) => {
    if (args.includes("apply")) {
      return { ok: false, output: "forbidden: developers cannot patch" };
    }
    const asController = args.includes(replicaSetController[1] ?? "");
    return asController ? { ok: true, output: "" } : refused;
  });

  await expect(assertClosedDenies(proof)).resolves.toBeUndefined();
});

test("a closed gate that lets a developer open it fails the proof", async () => {
  vi.mocked(kubectl).mockImplementation(async (_cluster, args) =>
    args.includes("apply") ? { ok: true, output: "" } : refused,
  );

  await expect(assertClosedDenies(proof)).rejects.toThrow(
    "a developer must not open the gate",
  );
});

test("the admission proof removes its access, constraint and namespace even when a step fails", async () => {
  vi.mocked(kubectl).mockImplementation(async (_cluster, args) =>
    args.includes("apply")
      ? { ok: false, output: "boom" }
      : { ok: true, output: "" },
  );

  await expect(proveAdmission(cluster, "registry.local/app:1")).rejects.toThrow(
    "bootstrap sets the proof gate closed: boom",
  );

  const created = vi
    .mocked(kubectl)
    .mock.calls.find(
      ([, args]) => args[0] === "create" && args[1] === "namespace",
    )?.[1][2];
  expect(created).toMatch(/^kore-gate-proof-[0-9a-f]{8}$/);
  expect(revokeProofGateAccess).toHaveBeenCalledWith(cluster, created);
  expect(kubectl).toHaveBeenCalledWith(cluster, [
    "delete",
    "namespace",
    created,
    "--ignore-not-found",
    "--wait=false",
  ]);
});
