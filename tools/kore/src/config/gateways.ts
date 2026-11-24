// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// Spec #1612: the environment declares an internal Gateway and an optional external one.
import type { Environment, GatewayEntry, GatewayRef } from "./types.js";

/** A lowercase DNS label: the rule a Gateway's name, namespace and issuer follow. */
const dnsLabel = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

/** An entry as an overlay may declare it: any field can be left out or hold the wrong type. */
type DeclaredEntry = Partial<GatewayEntry>;

/** The platform field as an overlay may declare it, widened so a half-filled one is refused, not thrown. */
type DeclaredPlatform = Partial<Environment["platform"]>;

const noGateway = (name: string) =>
  `environment ${name} must declare gateways.internal (or the single gateway field), for example kore-gateway in kore-system`;

const missingInternal = (name: string) =>
  `gateways.internal is required when gateways is declared; add gateways.internal with name, namespace, port and issuer (for example kore-gateway in kore-system on port 443 with issuer kore-local-ca) in environment ${name}`;

/**
 * The internal Gateway: gateways.internal once it is declared, else the single
 * gateway field. Every reader of the environment's Gateway takes it from here,
 * so the single field and the declared entry read the same way.
 */
export function internalGateway(environment: Environment): GatewayRef {
  const entry = environment.gateways?.internal ?? environment.gateway;
  if (entry === undefined) {
    throw new Error(noGateway(environment.name));
  }
  return entry;
}

/** The external Gateway, when gateways.external is declared. */
export function externalGateway(
  environment: Environment,
): GatewayEntry | undefined {
  return environment.gateways?.external;
}

/**
 * The internal domain: platform.internalDomain when it is declared, else the
 * platform domain. With no external Gateway the two are the same name.
 */
export function internalDomain(environment: Environment): string {
  return environment.platform.internalDomain ?? environment.platform.domain;
}

function isPort(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  );
}

/** The errors of one declared Gateway entry, each naming its field, the rule and an example. */
function entryErrors(
  field: string,
  entry: DeclaredEntry,
  name: string,
  issuer: boolean,
): string[] {
  const where = `in environment ${name}`;
  const errors: string[] = [];
  if (typeof entry.name !== "string" || !dnsLabel.test(entry.name)) {
    errors.push(
      `${field}.name must be a lowercase DNS label, for example kore-gateway, ${where}, got ${JSON.stringify(entry.name)}`,
    );
  }
  if (typeof entry.namespace !== "string" || !dnsLabel.test(entry.namespace)) {
    errors.push(
      `${field}.namespace must be a lowercase DNS label, for example kore-system, ${where}, got ${JSON.stringify(entry.namespace)}`,
    );
  }
  if (!isPort(entry.port)) {
    errors.push(
      `${field}.port must be a whole number from 1 to 65535, for example 443, ${where}, got ${JSON.stringify(entry.port)}`,
    );
  }
  if (
    issuer &&
    (typeof entry.issuer !== "string" || !dnsLabel.test(entry.issuer))
  ) {
    errors.push(
      `${field}.issuer must be a lowercase DNS label naming the certificate issuer, for example kore-local-ca, ${where}, got ${JSON.stringify(entry.issuer)}`,
    );
  }
  return errors;
}

function sameGateway(a: DeclaredEntry, b: DeclaredEntry): boolean {
  return a.name === b.name && a.namespace === b.namespace && a.port === b.port;
}

/** Whether a Gateway is declared at all: gateways.internal once gateways is declared, else the single field. */
function presenceErrors(environment: Environment): string[] {
  const { name, gateways, gateway } = environment;
  if (gateways !== undefined) {
    return gateways.internal === undefined ? [missingInternal(name)] : [];
  }
  return gateway === undefined ? [noGateway(name)] : [];
}

/** Each declared entry is valid, the external one is distinct, and the single field names the internal Gateway. */
function entriesErrors(environment: Environment): string[] {
  const { name, gateways, gateway } = environment;
  const internal = gateways?.internal;
  const external = gateways?.external;
  const errors: string[] = [];
  if (gateway !== undefined) {
    errors.push(...entryErrors("gateway", gateway, name, false));
  }
  if (internal !== undefined) {
    errors.push(...entryErrors("gateways.internal", internal, name, true));
  }
  if (external !== undefined) {
    errors.push(...entryErrors("gateways.external", external, name, true));
  }
  if (
    external !== undefined &&
    internal !== undefined &&
    external.name === internal.name
  ) {
    errors.push(
      `gateways.external.name must differ from gateways.internal.name (${internal.name}) in environment ${name}`,
    );
  }
  if (
    gateway !== undefined &&
    internal !== undefined &&
    !sameGateway(gateway, internal)
  ) {
    errors.push(
      `gateway and gateways.internal name different Gateways in environment ${name}: make gateways.internal match gateway (name, namespace and port), or remove gateway`,
    );
  }
  return errors;
}

/** With an external Gateway the internal domain is internal.<domain>; without one it is the platform domain. */
function domainErrors(environment: Environment): string[] {
  const { name } = environment;
  const where = `in environment ${name}`;
  const platform: DeclaredPlatform | undefined = environment.platform;
  const domain = platform?.domain;
  const declared = platform?.internalDomain;
  if (typeof domain !== "string") {
    return [];
  }
  if (environment.gateways?.external !== undefined) {
    if (declared === undefined) {
      return [
        `platform.internalDomain is required when gateways.external is declared: set it to internal.${domain} ${where}`,
      ];
    }
    return declared === `internal.${domain}`
      ? []
      : [
          `platform.internalDomain must be internal.${domain} when gateways.external is declared, ${where}, got ${JSON.stringify(declared)}`,
        ];
  }
  return declared === undefined || declared === domain
    ? []
    : [
        `platform.internalDomain must equal platform.domain (${domain}) when gateways.external is not declared, ${where}, got ${JSON.stringify(declared)}; remove platform.internalDomain to use the platform domain`,
      ];
}

/**
 * Schema checks of the Gateways and the internal domain, run before any cluster
 * command: a Gateway is declared, each entry is valid, the entries agree, and the
 * internal domain is the platform domain with no external Gateway, or
 * internal.<domain> with one.
 */
export function gatewayErrors(environment: Environment): string[] {
  return [
    ...presenceErrors(environment),
    ...entriesErrors(environment),
    ...domainErrors(environment),
  ];
}
