// Docs: docs/decisions/0042-organization-domains-by-delegation.md
import {
  featureEnabled,
  organizationServiceApisFlag,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";

export interface ClaimStatus {
  kind: string;
  name: string;
  ready: boolean;
  /** Why the claim is not ready; empty when it is. */
  reason: string;
}

export interface PlatformClaimsStatus {
  status: "gated-off" | "ready" | "degraded";
  /** Absent while the flag is off, so nothing is read from the cluster. */
  claims?: ClaimStatus[];
}

interface ClaimItem {
  kind?: string;
  metadata?: { name?: string };
  status?: {
    conditions?: { type?: string; status?: string; message?: string }[];
  };
}

function claimStatus(item: ClaimItem): ClaimStatus {
  const ready = item.status?.conditions?.find(
    (condition) => condition.type === "Ready",
  );
  const isReady = ready?.status === "True";
  return {
    kind: item.kind ?? "",
    name: item.metadata?.name ?? "",
    ready: isReady,
    reason: isReady ? "" : ready?.message || "no Ready condition yet",
  };
}

/**
 * Reports each Organization and Service claim in the configured context and
 * whether its Ready condition is True. Read-only: one kubectl get, never an
 * apply, patch or delete. With the flag off it reads nothing at all.
 */
export async function platformClaimsStatus(
  repository: Repository,
  runner: Runner,
): Promise<PlatformClaimsStatus> {
  if (!featureEnabled(repository.environment, organizationServiceApisFlag)) {
    return { status: "gated-off" };
  }
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "get",
      "organizations.platform.kore.dev,services.platform.kore.dev",
      "--output",
      "json",
    ],
    { capture: true },
  );
  const list = JSON.parse(stdout) as { items?: ClaimItem[] };
  const claims = (list.items ?? []).map(claimStatus);
  return {
    status: claims.every((claim) => claim.ready) ? "ready" : "degraded",
    claims,
  };
}
