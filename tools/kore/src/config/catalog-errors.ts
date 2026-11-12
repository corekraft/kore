import { crdGroupErrors, crdNameFormatErrors } from "./crd-ownership.js";
import { componentPatchErrors } from "./patch-validation.js";
import type { Component } from "./types.js";

/** Catalog-wide checks of CRD claims and probe patches, each naming the component. */
export function catalogErrors(components: Component[]): string[] {
  return [
    ...crdGroupErrors(components),
    ...components.flatMap((component) => [
      ...crdNameFormatErrors(component.name, component.ownsCRDs ?? []),
      ...componentPatchErrors(component),
    ]),
  ];
}
