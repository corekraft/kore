// The names a suborg may not take (ADR 0165). A suborg is named exactly like its
// namespace, so a name that is a platform namespace would take that namespace. The
// reserved set is built from the namespaces the catalog installs, so a namespace added
// to the catalog is reserved with no change here; default, internal, www and reference
// are reserved beside them, and kube- and kore- are reserved as prefixes.
// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md

import { featureEnabled, suborgSecretStoreFlag } from "./features.js";
import type { Environment } from "./types.js";

/**
 * Names the platform reserves beside the catalog's namespaces (ADR 0165, the reference app).
 * platform-configuration is the Argo CD AppProject the platform-config-delivery chart owns (ADR
 * 0043): a suborg's project is named after the suborg, so a suborg with that name would have
 * two owners for one AppProject.
 */
const extraReservedNames = [
  "default",
  "internal",
  "www",
  "reference",
  "platform-configuration",
];
const reservedPrefixes = ["kube-", "kore-"];

/** The reserved suborg names: every namespace the catalog installs, and the extra names. */
export function reservedSuborgNames(
  catalogNamespaces: readonly string[],
): ReadonlySet<string> {
  return new Set([...catalogNamespaces, ...extraReservedNames]);
}

/**
 * Why a suborg name is refused, as a message that names the field and a fix. The
 * prefix rule is checked first, so a kore- name that is also a namespace gets one
 * message. `path` is the record's file path, which the message begins with.
 */
export function reservedNameErrors(
  name: string,
  path: string,
  reserved: ReadonlySet<string>,
): string[] {
  const prefix = reservedPrefixes.find((candidate) =>
    name.startsWith(candidate),
  );
  if (prefix !== undefined) {
    return [
      `${path}.metadata.name: must not start with kube- or kore-, the reserved prefixes; rename it, for example "${name.slice(prefix.length)}"`,
    ];
  }
  if (reserved.has(name)) {
    return [
      `${path}.metadata.name: "${name}" is a reserved name: it is a platform namespace, an Argo CD project the platform owns, default, internal, www or reference; choose another name, for example "${name}-team"`,
    ];
  }
  return [];
}

/**
 * A suborg's default zone, <suborg>.<platform domain> (ADR 0042, ADR 0163): the zone the
 * hostname-ownership constraint reads for a suborg that does not declare another.
 */
export const suborgDefaultZone = (name: string, domain: string): string =>
  `${name}.${domain}`;

/**
 * The namespace a suborg's store reads its own source Secrets from (ADR 0167, issue 1555).
 * The kore- prefix is reserved, so no suborg namespace can take it.
 */
export const suborgSourceNamespace = (name: string): string =>
  `kore-suborg-${name}`;

/**
 * The longest suborg name that keeps its source namespace within the 63-character DNS
 * label a namespace must be (the kore-suborg- prefix is 12 characters).
 */
export const maxSecretStoreSuborgName = 63 - "kore-suborg-".length;

/**
 * Why a suborg name is refused while suborg-secret-store is on: its source namespace would
 * be longer than a namespace may be. `path` is the record's file path, which the message
 * begins with; the caller decides whether the flag is on.
 */
export function secretStoreNameErrors(name: string, path: string): string[] {
  if (name.length <= maxSecretStoreSuborgName) {
    return [];
  }
  return [
    `${path}.metadata.name: "${name}" is ${name.length} characters, too long for its source namespace ${suborgSourceNamespace(name)} while suborg-secret-store is on: a namespace name is at most 63 characters, so a suborg name is at most ${maxSecretStoreSuborgName} with that flag; choose a shorter name, for example "${name.slice(0, maxSecretStoreSuborgName)}", or turn suborg-secret-store off`,
  ];
}

/** Whether suborg-secret-store is on: each suborg then has a store, and its name must fit that store's source namespace. */
export const suborgSecretStoreOn = (
  environment: Pick<Environment, "features">,
): boolean => featureEnabled(environment, suborgSecretStoreFlag);
