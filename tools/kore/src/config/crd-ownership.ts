// Docs: infra/plans/2-implementation.md#step-7-bootstrap-registry-image-trust-controllers-and-crd-ownership

export interface CrdOwnership {
  name: string;
  /** CRD names the rendered chart installs. */
  rendered: string[];
  /** CRD names the catalog declares in ownsCRDs. */
  declared: string[];
}

// A Kubernetes CRD name is <plural>.<group>, and a group has at least one dot.
const label = "[a-z0-9]([-a-z0-9]*[a-z0-9])?";
const crdName = new RegExp(`^${label}(\\.${label}){2,}$`);

/** Names of every CustomResourceDefinition in a rendered multi-document YAML. */
export function renderedCrdNames(manifest: string): string[] {
  const names = manifest
    .split(/^---\s*$/m)
    .filter((doc) => /^kind:\s*CustomResourceDefinition\s*$/m.test(doc))
    .map(
      (doc) =>
        /^metadata:[ \t]*\n(?:[ \t]+.*\n|\n)*?[ ]{2}name:[ \t]*"?([^"\s]+)/m.exec(
          doc,
        )?.[1],
    )
    .filter((name): name is string => name !== undefined);
  return [...new Set(names)].sort();
}

export function crdNameFormatErrors(
  component: string,
  declared: string[],
): string[] {
  return declared
    .filter((crd) => !crdName.test(crd))
    .map(
      (crd) =>
        `${component}: ownsCRDs entry ${crd} must look like <plural>.<group>`,
    );
}

/** Missing, extra and duplicate CRD ownership across rendered components. */
export function checkCrdOwnership(components: CrdOwnership[]): string[] {
  const errors: string[] = [];
  const installers = new Map<string, string>();
  for (const { name, rendered, declared } of components) {
    for (const crd of rendered.filter((c) => !declared.includes(c))) {
      errors.push(
        `${name} installs CRD ${crd} but does not declare it in ownsCRDs`,
      );
    }
    for (const crd of declared.filter((c) => !rendered.includes(c))) {
      errors.push(
        `${name} declares CRD ${crd} in ownsCRDs but its chart does not install it`,
      );
    }
    for (const crd of rendered) {
      const other = installers.get(crd);
      if (other) {
        errors.push(
          `CRD ${crd} is installed by multiple components: ${other} and ${name}`,
        );
      }
      installers.set(crd, name);
    }
  }
  return errors;
}

/** Whether a string is a valid API group, such as widgets.example.com. */
function isApiGroup(group: string): boolean {
  // A CRD name is <plural>.<group>, so prefix a plural to reuse the CRD pattern.
  return crdName.test(`x.${group}`);
}

/** The API group of a CRD name: everything after the plural. */
function crdGroup(crd: string): string {
  return crd.slice(crd.indexOf(".") + 1);
}

export interface CrdClaims {
  name: string;
  /** CRD names the component declares. */
  ownsCRDs: string[];
  /**
   * API groups whose CRDs the component's controller creates at runtime
   * (Crossplane packages, Gatekeeper constraint templates). Optional.
   */
  ownsCRDGroups?: string[];
}

/** Components that own a CRD by name or by a claimed group, sorted. */
export function crdOwners(components: CrdClaims[], crd: string): string[] {
  const group = crdGroup(crd);
  return components
    .filter(
      (c) =>
        c.ownsCRDs.includes(crd) || (c.ownsCRDGroups ?? []).includes(group),
    )
    .map((c) => c.name)
    .sort();
}

/** Malformed group claims and overlaps between components' claims. */
export function crdGroupErrors(components: CrdClaims[]): string[] {
  const errors: string[] = [];
  const claimed = new Map<string, string>();
  for (const { name, ownsCRDGroups = [] } of components) {
    for (const group of ownsCRDGroups) {
      if (!isApiGroup(group)) {
        errors.push(
          `${name}: ownsCRDGroups entry ${group} must be an API group such as widgets.example.com`,
        );
        continue;
      }
      const other = claimed.get(group);
      if (other && other !== name) {
        errors.push(
          `CRD group ${group} is claimed by multiple components: ${other} and ${name}`,
        );
      }
      claimed.set(group, name);
    }
  }
  for (const { name, ownsCRDs } of components) {
    for (const crd of ownsCRDs) {
      const group = crdGroup(crd);
      const claimant = claimed.get(group);
      if (claimant && claimant !== name) {
        errors.push(
          `CRD ${crd} is owned by ${name} but ${claimant} claims its group ${group}`,
        );
      }
    }
  }
  return errors;
}

/**
 * Whether a CRD sits in a group the environment declares provider-owned
 * (ADR 0088): k3s ships its own CRDs, and no catalog component owns them.
 */
export function providerOwnsCrd(
  providerGroups: Record<string, string> | undefined,
  crd: string,
): boolean {
  return Object.hasOwn(providerGroups ?? {}, crdGroup(crd));
}

/**
 * The CRD groups each provider ships itself (ADR 0088). Only these may be
 * declared provider-owned; any other group belongs to a catalog component.
 */
export const providerShippedCrdGroups: Record<string, readonly string[]> = {
  k3d: ["k3s.cattle.io", "helm.cattle.io"],
  managed: [],
};

/**
 * Problems with the environment's provider-owned groups: each must be an API
 * group the provider ships, with a reason, and none may also be owned by a
 * catalog component, so a resource keeps exactly one owner.
 */
export function providerCrdGroupErrors(
  provider: string,
  providerGroups: Record<string, string> | undefined,
  components: CrdClaims[],
): string[] {
  const shipped = providerShippedCrdGroups[provider] ?? [];
  return Object.entries(providerGroups ?? {}).flatMap(([group, reason]) => {
    const prefix = `environment.providerOwnedCRDGroups: ${group}`;
    if (!isApiGroup(group)) {
      return [`${prefix} must be an API group such as widgets.example.com`];
    }
    const errors: string[] = [];
    if (!shipped.includes(group)) {
      errors.push(
        `${prefix} is not shipped by ${provider}; claim it in a catalog component with ownsCRDGroups instead`,
      );
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      errors.push(`${prefix} needs a reason`);
    }
    const owners = components
      .filter(
        (c) =>
          (c.ownsCRDGroups ?? []).includes(group) ||
          c.ownsCRDs.some((crd) => crdGroup(crd) === group),
      )
      .map((c) => c.name)
      .sort();
    if (owners.length > 0) {
      errors.push(
        `${prefix} is also owned by ${owners.join(" and ")}; a group has one owner`,
      );
    }
    return errors;
  });
}
