import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { scope, verdictOf, type AdmissionVerdict } from "./admission-probe.js";

// Docs: docs/decisions/0072-constraint-promotion-procedure.md

/**
 * Server dry-runs a Deployment whose pods run `image` as `serviceAccountName`.
 * Workload-level constraints (workload identity) match Deployments, never bare
 * Pods, so a Pod probe cannot show them enforcing. Nothing is created.
 */
export async function workloadVerdict(
  repository: Repository,
  runner: Runner,
  namespace: string,
  image: string,
  serviceAccountName: string,
): Promise<AdmissionVerdict> {
  const name = `kore-admission-probe-${Date.now().toString(36)}`;
  const labels = { "app.kubernetes.io/name": name };
  const deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name },
    spec: {
      replicas: 1,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName,
          automountServiceAccountToken: false,
          containers: [{ name: "probe", image }],
        },
      },
    },
  };
  return await verdictOf(
    runner,
    [
      ...scope(repository, namespace),
      "create",
      "--dry-run=server",
      "--filename=-",
    ],
    JSON.stringify(deployment),
  );
}
