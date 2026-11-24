// Docs: docs/decisions/0161-cert-manager-solves-dns-01-through-cloudflare-and-issues-per-suborg-wildcards-behind-acme-dns01.md
import { acmeDns01Flag, featureEnabled } from "./features.js";
import { platformDomainVariable, runTimeDomain } from "./run-time-domain.js";
import type { Environment } from "./types.js";

/** The catalog component cert-manager is installed as (infra/catalog/components.yaml). */
export const certManagerComponent = "cert-manager";

/** The catalog component that renders the platform certificate chart, which holds the issuers. */
export const platformCertificateComponent = "kore-local-tls";

/**
 * The public recursive resolvers cert-manager's DNS-01 self-check queries
 * (ADR 0161). The in-cluster rewrite sends every name under the platform zone
 * to the Gateway, so a self-check through cluster DNS would never see the
 * challenge record; two independent public operators answer it instead.
 */
const pinnedResolvers = ["1.1.1.1:53", "8.8.8.8:53"];

/**
 * The controller arguments that point cert-manager's self-check at the pinned
 * resolvers and only those, so the cluster's rewrite cannot hide the record.
 * Contains no domain: the resolvers are public addresses, not the platform's.
 */
export const acmeResolverArgs: readonly string[] = [
  `--dns01-recursive-nameservers=${pinnedResolvers.join(",")}`,
  "--dns01-recursive-nameservers-only",
];

/**
 * The problems that refuse a mutation while acme-dns01 is on (ADR 0164): a
 * managed environment still on the placeholder domain, which would issue for a
 * zone the platform does not own. Empty while the flag is off, and for a local
 * environment, which validation refuses on its own (provider-flag-errors.ts).
 */
export function acmeDns01Errors(
  environment: Environment,
  env: NodeJS.ProcessEnv,
): string[] {
  if (
    !featureEnabled(environment, acmeDns01Flag) ||
    environment.provider !== "managed" ||
    runTimeDomain(environment, env) !== undefined
  ) {
    return [];
  }
  return [
    `environment ${environment.name} turns on ${acmeDns01Flag}, which needs the platform domain: the overlay holds the placeholder ${environment.platform?.domain ?? ""}; set ${platformDomainVariable} in the shell that runs kore to the platform domain, or turn ${acmeDns01Flag} off`,
  ];
}

/**
 * The Helm arguments the acme-dns01 flag adds: cert-manager's pinned resolvers,
 * and the platform certificate chart's one zone, the platform domain the two
 * issuers select (ADR 0161). Off, or for another component, none, so the flag
 * off renders what it rendered before. Refuses with the error above rather than
 * rendering an issuer for the placeholder zone.
 */
export function acmeDns01HelmArgs(
  environment: Environment,
  component: string,
  env: NodeJS.ProcessEnv,
): string[] {
  if (!featureEnabled(environment, acmeDns01Flag)) {
    return [];
  }
  if (component === certManagerComponent) {
    return ["--set-json", `extraArgs=${JSON.stringify(acmeResolverArgs)}`];
  }
  if (component !== platformCertificateComponent) {
    return [];
  }
  const errors = acmeDns01Errors(environment, env);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  const domain =
    runTimeDomain(environment, env) ?? environment.platform?.domain;
  return ["--set-string", `acmeDns01.zone=${domain ?? ""}`];
}
