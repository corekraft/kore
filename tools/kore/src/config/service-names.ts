// The one derivation of a service's names (ADR 0159): its internal name, its default
// public name and the names that need a claim. Validation reads it, and so do the
// consumers that name a service's hosts. Pure: it reads no file and no environment,
// so the caller passes the domains in force.
// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md

/** The placeholder platform domain the repository holds (ADR 0164). */
export const placeholderPlatformDomain = "kore.internal";

export type GatewayChoice = "internal" | "external";

export interface ServiceNameInput {
  /** The service name: the record's file name without .json. */
  name: string;
  /** The record's organization, the suborg that owns the service (ADR 0166). */
  organization: string;
  gateway: GatewayChoice;
  /** The record's hostnames list; empty when the record lists none. */
  hostnames: readonly string[];
  /** The platform domain in force. */
  domain: string;
  /** The internal domain: the platform domain, or internal.<domain> with an external Gateway. */
  internalDomain: string;
}

export interface ServiceNames {
  /** <service>.<organization>.<internal domain>: every service has it, and a hostnames list never replaces it. */
  internal: string;
  /** <service>.<organization>.<domain>: set only for gateway external with no hostnames list. */
  defaultPublic: string | undefined;
  /** The public names: the hostnames list when it has one, else the default public name when there is one. */
  publicNames: string[];
  /** The public names that need a claim: directly under the platform domain and outside the claimant's own zone. */
  claimed: string[];
}

/** The zone a suborg owns under a domain: <organization>.<domain> (ADR 0042, ADR 0165). */
export const suborgZone = (organization: string, domain: string): string =>
  `${organization}.${domain}`;

/**
 * Whether a public name needs a claim: it sits directly under the platform domain
 * and is not the apex of the claimant's own zone (ADR 0159).
 */
export function isClaim(
  host: string,
  organization: string,
  domain: string,
): boolean {
  const suffix = `.${domain}`;
  if (!host.endsWith(suffix)) {
    return false;
  }
  const rest = host.slice(0, -suffix.length);
  return !rest.includes(".") && rest !== organization;
}

/** The names of one service, derived from its record and the domains in force. */
export function serviceNames(input: ServiceNameInput): ServiceNames {
  const { name, organization, gateway, hostnames, domain, internalDomain } =
    input;
  const internal = `${name}.${organization}.${internalDomain}`;
  const defaultPublic =
    gateway === "external" && hostnames.length === 0
      ? `${name}.${organization}.${domain}`
      : undefined;
  const publicNames: string[] = [...hostnames];
  if (publicNames.length === 0 && defaultPublic !== undefined) {
    publicNames.push(defaultPublic);
  }
  const claimed = publicNames.filter((host) =>
    isClaim(host, organization, domain),
  );
  return { internal, defaultPublic, publicNames, claimed };
}
