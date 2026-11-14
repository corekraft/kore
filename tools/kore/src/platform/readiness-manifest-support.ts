// Fixtures shared by the readiness manifest unit spec. A support file is not a
// unit, so it needs no spec of its own (ADR 0098).
import type { Repository } from "../config/index.js";
import type { ComponentStatus } from "./status.js";

/** A repository whose readiness manifest has the given requirements. */
export function repositoryWith(
  requirements: {
    name: string;
    step: number;
    capability: string;
    components?: string[];
    platformChecks?: string[];
  }[],
): Repository {
  return {
    readiness: { version: 1, requirements },
    environment: { name: "local", kubeContext: "k3d-kore-local" },
  } as unknown as Repository;
}

export const row = (
  name: string,
  status: ComponentStatus["status"],
  detail = "ok",
) => ({ name, namespace: "kore-system", status, detail }) as ComponentStatus;

/** Two requirements: the gateway, then the policy with its gate and registry trust. */
export const manifest = repositoryWith([
  {
    name: "gateway-ready",
    step: 1,
    capability: "ingress",
    components: ["gateway"],
  },
  {
    name: "policy-ready",
    step: 2,
    capability: "policy",
    components: ["policy", "gate"],
    platformChecks: ["registry-trust"],
  },
]);
