import {
  crdGroupErrors,
  crdNameFormatErrors,
  providerCrdGroupErrors,
} from "./crd-ownership.js";
import { componentPatchErrors } from "./patch-validation.js";
import type { Component, Environment } from "./types.js";

/** Catalog-wide checks of CRD claims, provider-owned CRD groups and probe patches, each naming the component. */
export function catalogErrors(
  environment: Environment,
  components: Component[],
): string[] {
  return [
    ...crdGroupErrors(components),
    ...providerCrdGroupErrors(
      environment.provider,
      environment.providerOwnedCRDGroups,
      components,
    ),
    ...components.flatMap((component) => [
      ...crdNameFormatErrors(component.name, component.ownsCRDs ?? []),
      ...componentPatchErrors(component),
    ]),
  ];
}
