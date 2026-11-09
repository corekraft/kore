import assert from "node:assert/strict";
import { bootstrapUser, kubectl, type Live } from "./gate-live.js";

interface RbacItem {
  apiVersion: string;
  kind: string;
  metadata: { name: string };
  rules?: unknown[];
  roleRef?: { apiGroup: string; kind: string; name: string };
  subjects?: unknown[];
}

/**
 * Production bootstrap RBAC is limited to the platform gate by name, so the
 * throwaway proof constraint needs its own grant: exactly that name, for the
 * impersonated bootstrap user, removed again when the proof ends.
 */
export function proofGateAccess(constraint: string): {
  apiVersion: string;
  kind: string;
  items: RbacItem[];
} {
  const role = `${constraint}-bootstrap`;
  const api = "rbac.authorization.k8s.io";
  return {
    apiVersion: "v1",
    kind: "List",
    items: [
      {
        apiVersion: `${api}/v1`,
        kind: "ClusterRole",
        metadata: { name: role },
        rules: [
          {
            apiGroups: ["constraints.gatekeeper.sh"],
            resources: ["koreapplicationadmission"],
            resourceNames: [constraint],
            verbs: ["get", "update", "patch"],
          },
        ],
      },
      {
        apiVersion: `${api}/v1`,
        kind: "ClusterRoleBinding",
        metadata: { name: role },
        roleRef: { apiGroup: api, kind: "ClusterRole", name: role },
        subjects: [{ apiGroup: api, kind: "User", name: bootstrapUser }],
      },
    ],
  };
}

export async function grantProofGateAccess(
  cluster: Live,
  constraint: string,
): Promise<void> {
  const result = await kubectl(
    cluster,
    ["apply", "--filename=-"],
    JSON.stringify(proofGateAccess(constraint)),
  );
  assert.ok(result.ok, `grant the proof gate access: ${result.output}`);
}

export async function revokeProofGateAccess(
  cluster: Live,
  constraint: string,
): Promise<void> {
  await kubectl(cluster, [
    "delete",
    "clusterrolebinding",
    "clusterrole",
    `${constraint}-bootstrap`,
    "--ignore-not-found",
  ]);
}
