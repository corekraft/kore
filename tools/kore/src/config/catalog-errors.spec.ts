import { beforeEach, expect, test, vi } from "vitest";
import { catalogErrors } from "./catalog-errors.js";
import {
  crdGroupErrors,
  crdNameFormatErrors,
  providerCrdGroupErrors,
} from "./crd-ownership.js";
import { componentPatchErrors } from "./patch-validation.js";
import type { Component, Environment } from "./types.js";

// Factories, not automocks: the collaborators' real modules never load here.
vi.mock("./crd-ownership.js", () => ({
  crdGroupErrors: vi.fn(),
  crdNameFormatErrors: vi.fn(),
  providerCrdGroupErrors: vi.fn(),
}));
vi.mock("./patch-validation.js", () => ({ componentPatchErrors: vi.fn() }));

const environment = {
  provider: "k3d",
  providerOwnedCRDGroups: { "k3s.cattle.io": "shipped by k3s" },
} as unknown as Environment;

function component(name: string, ownsCRDs?: string[]): Component {
  return { name, ownsCRDs } as unknown as Component;
}

beforeEach(() => {
  vi.mocked(crdGroupErrors).mockReturnValue([]);
  vi.mocked(providerCrdGroupErrors).mockReturnValue([]);
  vi.mocked(crdNameFormatErrors).mockReturnValue([]);
  vi.mocked(componentPatchErrors).mockReturnValue([]);
});

test("a catalog with no problems reports none, and every check runs once", () => {
  const components = [component("kore-registry", ["certs.example.com"])];
  expect(catalogErrors(environment, components)).toEqual([]);
  expect(vi.mocked(crdGroupErrors).mock.calls).toEqual([[components]]);
  expect(vi.mocked(providerCrdGroupErrors).mock.calls).toEqual([
    ["k3d", { "k3s.cattle.io": "shipped by k3s" }, components],
  ]);
  expect(vi.mocked(crdNameFormatErrors).mock.calls).toEqual([
    ["kore-registry", ["certs.example.com"]],
  ]);
  expect(vi.mocked(componentPatchErrors).mock.calls).toEqual([[components[0]]]);
});

test("the catalog-wide CRD group errors come first, then the provider-owned group errors", () => {
  vi.mocked(crdGroupErrors).mockReturnValue(["group clash"]);
  vi.mocked(providerCrdGroupErrors).mockReturnValue(["provider clash"]);
  expect(catalogErrors(environment, [component("kore-ui")])).toEqual([
    "group clash",
    "provider clash",
  ]);
});

test("a component without ownsCRDs is checked against an empty list of names", () => {
  catalogErrors(environment, [component("kore-ui")]);
  expect(vi.mocked(crdNameFormatErrors).mock.calls).toEqual([["kore-ui", []]]);
});

test("each component's name errors and patch errors follow the catalog-wide errors, in component order", () => {
  vi.mocked(crdGroupErrors).mockReturnValue(["catalog-wide"]);
  vi.mocked(crdNameFormatErrors)
    .mockReturnValueOnce(["kore-registry: bad name"])
    .mockReturnValueOnce([]);
  vi.mocked(componentPatchErrors)
    .mockReturnValueOnce([])
    .mockReturnValueOnce(["kore-ui: patch error"]);
  expect(
    catalogErrors(environment, [
      component("kore-registry", ["bad"]),
      component("kore-ui", ["ok.example.com"]),
    ]),
  ).toEqual([
    "catalog-wide",
    "kore-registry: bad name",
    "kore-ui: patch error",
  ]);
});
