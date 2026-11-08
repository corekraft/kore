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
