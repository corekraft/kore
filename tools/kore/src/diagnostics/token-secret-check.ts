import { isLocalProvider, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  activeTokenConsumers,
  cloudflareTokenSecretName,
} from "../security/index.js";
import type { Check } from "./doctor.js";

// Docs: docs/decisions/0163-one-cloudflare-zone-holds-the-platform-domain-opentofu-owns-fixed-records-and-external-dns-owns-route-records.md

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read-only doctor check: for each consumer whose flag is on in a managed
 * environment, whether its cloudflare-token Secret is present. The probe asks
 * for the object's name only, so the value never leaves the cluster. An absent
 * Secret or an unreachable cluster warns with the fix and never fails doctor.
 */
export async function tokenSecretChecks(
  repository: Repository,
  runner: Runner,
): Promise<Check[]> {
  const { environment } = repository;
  if (isLocalProvider(environment)) {
    return [];
  }
  const checks: Check[] = [];
  for (const consumer of activeTokenConsumers(environment)) {
    const secret = `${consumer.namespace}/${cloudflareTokenSecretName}`;
    const base = { name: `token:${consumer.name}`, required: false } as const;
    try {
      const { stdout } = await runner.run(
        "kubectl",
        [
          "--context",
          environment.kubeContext,
          "--namespace",
          consumer.namespace,
          "get",
          "secret",
          cloudflareTokenSecretName,
          "--ignore-not-found",
          "--output",
          "name",
        ],
        { capture: true },
      );
      checks.push(
        stdout.trim() === ""
          ? {
              ...base,
              status: "warn",
              message: `absent: ${secret} is not applied; create infra/environments/${environment.name}/secrets/${consumer.document} with sops, then run kore secrets tokens --environment ${environment.name}`,
            }
          : { ...base, status: "pass", message: `present: ${secret}` },
      );
    } catch (error) {
      checks.push({
        ...base,
        status: "warn",
        message: `${secret} could not be read: ${errorText(error)}; check that the cluster is reachable`,
      });
    }
  }
  return checks;
}
