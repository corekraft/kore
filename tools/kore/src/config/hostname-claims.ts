// The claim rules of a service's hostnames (ADR 0159, layer 1): kore validate reads
// every record of an environment and refuses a hostname that breaks them, before a
// merge. Pure: the caller reads the records and passes the domains in force, the
// suborgs and the reserved names. A name inside the claimant's own zone needs no
// claim; a name directly under the platform domain is a claim, and the first record
// that lists it holds it exclusively.
// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md

import { platformDomainVariable } from "./run-time-domain.js";
import {
  isClaim,
  placeholderPlatformDomain,
  suborgZone,
} from "./service-names.js";

/** The domains and Gateway facts in force, read by the caller (ADR 0164 for the domain). */
export interface ClaimEnvironment {
  /** The platform domain in force, the run-time value over the overlay's when one is set. */
  domain: string;
  /** The internal domain: the platform domain, or internal.<domain> with an external Gateway. */
  internalDomain: string;
  /** Whether gateways.external is declared. */
  externalGateway: boolean;
  /** Whether the domain in force is the placeholder (ADR 0164). */
  placeholder: boolean;
}

/** A service record, read as far as its claims need. The fields keep the record's own types. */
export interface ServiceClaim {
  /** The spec file's repository path, which the messages begin with. */
  file: string;
  /** The service name: the file name without .json. */
  name: string;
  /** The record's spec.organization, the suborg that owns the service (ADR 0166). */
  organization: unknown;
  /** The record's spec.gateway; absent means internal, the XRD default. */
  gateway: unknown;
  /** The record's spec.hostnames, when it lists any. */
  hostnames: unknown;
}

/** A suborg record: its name, and the file a message about it names. */
export interface SuborgRecord {
  name: string;
  file: string;
}

export interface HostnameClaimInput {
  environment: ClaimEnvironment;
  /** The services in the order they are read: the first record that lists a claim holds it. */
  services: readonly ServiceClaim[];
  suborgs: readonly SuborgRecord[];
  /** The reserved names, read from infra/catalog/reserved-hostnames.json. */
  reserved: ReadonlySet<string>;
}

/** The reserved-name file's repository path, named in the reserved message. */
export const reservedHostnamesFile = "infra/catalog/reserved-hostnames.json";

const dnsLabel = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The claim a held name records: who listed it first. */
interface Held {
  file: string;
  name: string;
  organization: string;
}

const organizationOf = (service: ServiceClaim): string =>
  typeof service.organization === "string" ? service.organization : "";

/** The part of a name before `.base`, or undefined when the name is not under `base`. */
function under(host: string, base: string): string | undefined {
  const suffix = `.${base}`;
  return host.endsWith(suffix) ? host.slice(0, -suffix.length) : undefined;
}

/** The form of a name a record may list, before any zone rule applies. */
function formError(host: unknown, at: string, domain: string): string[] {
  if (typeof host !== "string") {
    return [
      `${at} must be a string, a lowercase DNS name such as login.${domain}`,
    ];
  }
  if (host !== host.toLowerCase()) {
    return [`${at} "${host}" must be lowercase; write "${host.toLowerCase()}"`];
  }
  if (host.includes("*")) {
    return [
      `${at} "${host}" is a wildcard: wildcards are refused in v1; list the exact name, for example login.${domain}`,
    ];
  }
  if (ipv4.test(host) || host.includes(":")) {
    return [
      `${at} "${host}" is an IP address: list a DNS name, for example login.${domain}`,
    ];
  }
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => dnsLabel.test(label))) {
    return [
      `${at} "${host}" must be a lowercase DNS name of letters, digits and hyphens with at least two labels, for example login.${domain}`,
    ];
  }
  if (labels.some((label) => label.startsWith("xn--"))) {
    return [
      `${at} "${host}" is a punycode (xn--) name: punycode names are refused in v1; list the name in plain letters and digits, for example login.${domain}`,
    ];
  }
  return [];
}

/**
 * The Gateway facts an external service needs: the environment declares an external
 * Gateway, and the platform domain in force is not the placeholder (ADR 0164).
 */
function gatewayErrors(
  service: ServiceClaim,
  environment: ClaimEnvironment,
): string[] {
  if (service.gateway !== "external") {
    return [];
  }
  const errors: string[] = [];
  if (!environment.externalGateway) {
    errors.push(
      `${service.file}: spec.gateway is external, but the environment declares no external Gateway: declare gateways.external in the environment, or set spec.gateway to internal`,
    );
  }
  if (environment.placeholder) {
    errors.push(
      `${service.file}: spec.gateway is external while the platform domain is the placeholder ${placeholderPlatformDomain}: set ${platformDomainVariable} in the shell that runs kore to the platform domain (ADR 0164)`,
    );
  }
  return errors;
}

/** What the zone rules of one listed name read: the record's position and the names in force. */
interface Scope {
  at: string;
  base: string;
  organization: string;
  organizations: ReadonlySet<string>;
  reserved: ReadonlySet<string>;
  domain: string;
}

/** The zone and claim rules of one listed name, relative to the Gateway's base domain. */
function zoneError(host: string, scope: Scope): string | undefined {
  const { at, base, organization, organizations, reserved, domain } = scope;
  const rest = under(host, base);
  if (rest === undefined) {
    return undefined;
  }
  const parts = rest.split(".");
  if (parts.length >= 2) {
    const zone = parts[parts.length - 1] ?? "";
    if (zone === organization) {
      return undefined;
    }
    if (organizations.has(zone)) {
      return `${at} "${host}" is in the zone of ${zone} (${suborgZone(zone, base)}), another organization's zone: list a name in ${suborgZone(organization, base)} or directly under ${base}, for example login.${base}`;
    }
    return `${at} "${host}" is under ${zone}.${base}, which no organization owns: name a host directly under ${base}, for example login.${base}, or a name in your own zone, for example shop.${suborgZone(organization, base)}`;
  }
  if (rest === organization) {
    return undefined;
  }
  if (base !== domain) {
    return `${at} "${host}" is directly under ${base}, outside any organization's zone: name a host in ${suborgZone(organization, base)}, for example shop.${suborgZone(organization, base)}`;
  }
  if (organizations.has(rest)) {
    return `${at} "${host}" is the name of organization ${rest}, whose zone is ${suborgZone(rest, domain)}: a claim cannot take an organization's name; choose a name that no organization uses, for example ${rest}-team.${domain}`;
  }
  if (reserved.has(rest)) {
    return `${at} "${host}" is a reserved name: ${rest} cannot be claimed; the reserved names are in ${reservedHostnamesFile}; choose another name, for example ${rest}-app.${domain}`;
  }
  return undefined;
}

/** The problems of one service's hostnames list, and the claims it holds. */
function hostnameErrors(
  service: ServiceClaim,
  input: HostnameClaimInput,
  organizations: ReadonlySet<string>,
  held: Map<string, Held>,
): string[] {
  const { environment, reserved } = input;
  const { domain, internalDomain } = environment;
  if (!Array.isArray(service.hostnames)) {
    return [];
  }
  const external = service.gateway === "external";
  const base = external ? domain : internalDomain;
  const organization = organizationOf(service);
  const errors: string[] = [];
  service.hostnames.forEach((host: unknown, index) => {
    const at = `${service.file}: spec.hostnames[${index}]`;
    const form = formError(host, at, domain);
    if (form.length > 0) {
      errors.push(...form);
      return;
    }
    const name = host as string;
    if (name === base) {
      errors.push(
        `${at} "${name}" is the apex of ${base}: the apex is refused; list a name under it, for example login.${base}`,
      );
      return;
    }
    if (under(name, base) === undefined) {
      if (!external) {
        errors.push(
          `${at} "${name}" is under another domain: gateway internal serves names under ${internalDomain}; set gateway external, or list a name under ${internalDomain}`,
        );
      }
      return;
    }
    const zone = zoneError(name, {
      at,
      base,
      organization,
      organizations,
      reserved,
      domain,
    });
    if (zone !== undefined) {
      errors.push(zone);
      return;
    }
    if (base !== domain || !isClaim(name, organization, domain)) {
      return;
    }
    const holder = held.get(name);
    if (holder === undefined) {
      held.set(name, { file: service.file, name: service.name, organization });
    } else if (holder.file === service.file) {
      errors.push(`${at} "${name}" is listed twice: remove the repeat`);
    } else {
      errors.push(
        `${at} "${name}" is already claimed by ${holder.file} (service ${holder.name} in suborg ${holder.organization}): the first claim holds a name exclusively; remove it from this record or choose another name`,
      );
    }
  });
  return errors;
}

/** A suborg whose name a service claims: the suborg is the later name and is refused on its own record too. */
function suborgErrors(
  suborgs: readonly SuborgRecord[],
  services: readonly ServiceClaim[],
  domain: string,
): string[] {
  return suborgs.flatMap((suborg) => {
    const host = `${suborg.name}.${domain}`;
    const holder = services.find(
      (service) =>
        Array.isArray(service.hostnames) &&
        service.hostnames.includes(host) &&
        isClaim(host, organizationOf(service), domain),
    );
    if (holder === undefined) {
      return [];
    }
    return [
      `${suborg.file}: suborg ${suborg.name} is named like the hostname ${host} claimed by ${holder.file} (service ${holder.name}): a suborg cannot take a name that a service claims; rename the suborg, or remove the claim`,
    ];
  });
}

/**
 * Every claim rule a service's hostnames break, as messages that name the file, the
 * field and the fix. The services are read in order: the first record that lists a
 * claim holds it, so a later record's claim of the same name is refused, naming the
 * holder. A record whose gateway is external is checked against the declared Gateway
 * and the placeholder. Names under another domain on the external Gateway are not
 * refused here: that is the decision on names under other domains (ADR 0157).
 */
export function hostnameClaimErrors(input: HostnameClaimInput): string[] {
  const { environment, services, suborgs } = input;
  const organizations = new Set([
    ...suborgs.map((suborg) => suborg.name),
    "platform",
  ]);
  const held = new Map<string, Held>();
  const errors = services.flatMap((service) => [
    ...gatewayErrors(service, environment),
    ...hostnameErrors(service, input, organizations, held),
  ]);
  return [...errors, ...suborgErrors(suborgs, services, environment.domain)];
}
