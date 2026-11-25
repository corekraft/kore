// The names a suborg may not take (ADR 0165). A suborg is named exactly like its
// namespace, so a name that is a platform namespace would take that namespace. The
// reserved set is built from the namespaces the catalog installs, so a namespace added
// to the catalog is reserved with no change here; default, internal, www and reference
// are reserved beside them, and kube- and kore- are reserved as prefixes.
// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md

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
