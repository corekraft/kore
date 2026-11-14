// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { expect, test, vi } from "vitest";
import { kubectl, type Live } from "./gate-live.js";
import {
  grantProofGateAccess,
  proofGateAccess,
  revokeProofGateAccess,
} from "./gate-proof-access.js";
import { repositoryOf, runnerFake } from "./gate-unit-support.js";

vi.mock("./gate-live.js");

const constraint = "kore-gate-proof-1234abcd";
const cluster: Live = {
  repository: repositoryOf({ kubeContext: "k3d-kore-local" }),
  runner: runnerFake().runner,
};

test("proof access grants only the named proof constraint, and only its get, update and patch", () => {
  const role = proofGateAccess(constraint).items.find(
    (item) => item.kind === "ClusterRole",
  );

  expect(role?.rules).toEqual([
    {
      apiGroups: ["constraints.gatekeeper.sh"],
      resources: ["koreapplicationadmission"],
      resourceNames: [constraint],
      verbs: ["get", "update", "patch"],
    },
  ]);
});

test("proof access binds that role to the bootstrap user alone, with no wildcard anywhere", () => {
  const items = proofGateAccess(constraint).items;
  const binding = items.find((item) => item.kind === "ClusterRoleBinding");

  expect(binding?.subjects).toEqual([
    {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "User",
      name: "kore-gate-bootstrap",
    },
  ]);
  expect(binding?.roleRef?.name).toBe(`${constraint}-bootstrap`);
  expect(JSON.stringify(items)).not.toContain("*");
});

test("granting applies the access as a List on stdin, and succeeds when kubectl does", async () => {
  vi.mocked(kubectl).mockResolvedValue({ ok: true, output: "" });

  await grantProofGateAccess(cluster, constraint);

  expect(kubectl).toHaveBeenCalledWith(
    cluster,
    ["apply", "--filename=-"],
    JSON.stringify(proofGateAccess(constraint)),
  );
});

test("a refused grant stops the proof, naming kubectl's output", async () => {
  vi.mocked(kubectl).mockResolvedValue({
    ok: false,
    output: "forbidden: cannot create clusterroles",
  });

  await expect(grantProofGateAccess(cluster, constraint)).rejects.toThrow(
    "grant the proof gate access: forbidden: cannot create clusterroles",
  );
});

test("revoking deletes the role and its binding by name, ignoring any that are already gone", async () => {
  vi.mocked(kubectl).mockResolvedValue({ ok: true, output: "" });

  await revokeProofGateAccess(cluster, constraint);

  expect(kubectl).toHaveBeenCalledWith(cluster, [
    "delete",
    "clusterrolebinding",
    "clusterrole",
    `${constraint}-bootstrap`,
    "--ignore-not-found",
  ]);
});

test("a refused revoke does not fail the proof, since cleanup must never mask its outcome", async () => {
  vi.mocked(kubectl).mockResolvedValue({ ok: false, output: "unavailable" });

  await expect(
    revokeProofGateAccess(cluster, constraint),
  ).resolves.toBeUndefined();
});
