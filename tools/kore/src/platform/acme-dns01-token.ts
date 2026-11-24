import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  activeTokenConsumers,
  cloudflareTokenSecretName,
} from "../security/index.js";

// Docs: docs/decisions/0161-cert-manager-solves-dns-01-through-cloudflare-and-issues-per-suborg-wildcards-behind-acme-dns01.md

/** The catalog component whose chart renders the acme-dns01 issuers (infra/catalog/components.yaml). */
const issuerComponent = "kore-local-tls";
const NOT_FOUND = /NotFound|not found/i;

/**
 * Read-only preflight before the platform certificate chart is installed: while
 * acme-dns01 is on, the acme-dns01 consumer's cloudflare-token Secret must be
 * applied, because the issuers read it when they solve a challenge. Absent, the
 * install is refused naming the Secret, its sops document and the fix, rather
 * than issuers that never become usable. The probe asks for the object's name
 * only, so the token value never leaves the cluster. Any other error, an
 * unreachable cluster included, is rethrown as it is. Reads nothing while the
 * flag is off or for another component.
 */
export async function assertAcmeTokenSecret(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<void> {
  if (component.name !== issuerComponent) {
    return;
  }
  const { environment } = repository;
  const consumer = activeTokenConsumers(environment).find(
    (active) => active.name === "acme-dns01",
  );
  if (consumer === undefined) {
    return;
  }
  try {
    await runner.run(
      "kubectl",
      [
        "--context",
        environment.kubeContext,
        "--namespace",
        consumer.namespace,
        "get",
        `secret/${cloudflareTokenSecretName}`,
        "--output",
        "name",
      ],
      { capture: true },
    );
  } catch (error) {
    if (error instanceof Error && NOT_FOUND.test(error.message)) {
      throw new Error(
        `${consumer.namespace}/${cloudflareTokenSecretName} is not applied, so the acme-dns01 issuers cannot solve DNS-01; create infra/environments/${environment.name}/secrets/${consumer.document} with sops, then run kore secrets tokens --environment ${environment.name}`,
      );
    }
    throw error;
  }
}
