// Docs: docs/decisions/0157-a-name-under-another-domain-is-served-after-an-http-01-proof-and-certificates-come-from-acme.md
import { acmeIssuersFlag, featureEnabled } from "./features.js";
import { platformDomainVariable, runTimeDomain } from "./run-time-domain.js";
import type { Environment } from "./types.js";

/**
 * The staging ClusterIssuer acme-dns01 renders, which is the issuer every ACME
 * Certificate names until acme-production exists (ADR 0157). The name is the
 * one the chart's acmeDns01.issuers list holds first, so the two cannot drift
 * apart without the integration spec failing.
 */
const stagingIssuer = "letsencrypt-staging";

/**
 * The ClusterIssuer an ACME Certificate names. It is always staging: no
 * acme-production flag exists yet, so a production issuer is never chosen, and
 * the flag that switches it lands with that flag (ADR 0157).
 */
export function acmeCertificateIssuer(): string {
  return stagingIssuer;
}

/**
 * The problems that refuse a mutation while acme-issuers is on (ADR 0157): a
 * managed environment still on the placeholder domain, which would issue
 * HTTP-01 proofs for a domain the platform does not own. Empty while the flag
 * is off, and for a local environment, which the manifest refuses on its own.
 */
export function acmeIssuersErrors(
  environment: Environment,
  env: NodeJS.ProcessEnv,
): string[] {
  if (
    !featureEnabled(environment, acmeIssuersFlag) ||
    environment.provider !== "managed" ||
    runTimeDomain(environment, env) !== undefined
  ) {
    return [];
  }
  return [
    `environment ${environment.name} turns on ${acmeIssuersFlag}, which needs the platform domain: the overlay holds the placeholder ${environment.platform?.domain ?? ""}; set ${platformDomainVariable} in the shell that runs kore to the platform domain, or turn ${acmeIssuersFlag} off`,
  ];
}
