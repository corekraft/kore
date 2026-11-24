// Docs: docs/decisions/0157-a-name-under-another-domain-is-served-after-an-http-01-proof-and-certificates-come-from-acme.md
import { appliedFlags } from "./flag-manifest.js";
import {
  acmeIssuersFlag,
  externalGatewayFlag,
  featureEnabled,
} from "./features.js";
import { platformDomainVariable, runTimeDomain } from "./run-time-domain.js";
import type { Environment, FlagManifest } from "./types.js";

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
 * The prerequisite external-gateway needs on acme-issuers, checked where the
 * manifest says acme-issuers applies (ADR 0157, issue 1637). The manifest's
 * requires cannot bind only there yet (ADR 0148), so this check holds the
 * edge: external-gateway on, acme-issuers applying to the environment and
 * acme-issuers off is refused, naming both flags and the fix. Where
 * acme-issuers does not apply, as in local and managed-example, it is silent.
 */
export function externalGatewayAcmeIssuersErrors(
  environment: Environment,
  flags: FlagManifest,
): string[] {
  if (
    !featureEnabled(environment, externalGatewayFlag) ||
    !appliedFlags(flags, environment.name).includes(acmeIssuersFlag) ||
    featureEnabled(environment, acmeIssuersFlag)
  ) {
    return [];
  }
  return [
    `environment ${environment.name} turns on ${externalGatewayFlag}, which needs ${acmeIssuersFlag}, but ${acmeIssuersFlag} is off there; set "${acmeIssuersFlag}": true in the ${environment.name} overlay, or turn ${externalGatewayFlag} off (ADR 0157)`,
  ];
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
