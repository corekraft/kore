import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { type Runner } from "../runtime/index.js";
import {
  grantProofGateAccess,
  proofGateAccess,
  revokeProofGateAccess,
} from "./gate-proof-access.js";

const name = "kore-gate-proof-1234abcd";

test("proof access grants only the named proof constraint to the bootstrap identity", () => {
  const items = proofGateAccess(name).items;
  const role = items.find((item) => item.kind === "ClusterRole");
  const binding = items.find((item) => item.kind === "ClusterRoleBinding");
  expect(role?.rules).toEqual([
    {
      apiGroups: ["constraints.gatekeeper.sh"],
      resources: ["koreapplicationadmission"],
      resourceNames: [name],
      verbs: ["get", "update", "patch"],
    },
  ]);
  expect(binding?.subjects).toEqual([
    {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "User",
      name: "kore-gate-bootstrap",
    },
  ]);
  expect(binding?.roleRef?.name).toBe(role?.metadata.name);
  expect(JSON.stringify(items)).not.toContain("*");
});

function fakeCluster(calls: string[][]) {
  const runner: Runner = {
    async run(_command, args, options) {
      calls.push([...args, options?.input ?? ""]);
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return runner;
}

test("proof access is applied before use and deleted afterwards by name", async () => {
  const repository = await loadRepository("local", process.cwd() + "/../..");
  const calls: string[][] = [];
  const cluster = { repository, runner: fakeCluster(calls) };
  await grantProofGateAccess(cluster, name);
  expect(calls[0]).toContain("apply");
  expect(calls[0]?.at(-1)).toContain(name);
  await revokeProofGateAccess(cluster, name);
  const del = calls[1] ?? [];
  expect(del).toContain("delete");
  expect(del).toContain("clusterrole");
  expect(del).toContain("clusterrolebinding");
  expect(del).toContain(`${name}-bootstrap`);
  expect(del).toContain("--ignore-not-found");
});
