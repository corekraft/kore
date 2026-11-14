import assert from "node:assert/strict";
import { test } from "vitest";
import {
  checkCrdOwnership,
  crdGroupErrors,
  crdNameFormatErrors,
  crdOwners,
  providerCrdGroupErrors,
  providerOwnsCrd,
  renderedCrdNames,
} from "./crd-ownership.js";

const crd = (
  name: string,
  extra = "",
): string => `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  annotations:
    note: "name: not-this-one"
  name: ${name}
${extra}spec:
  group: example.com
`;

test("rendered CRD names come only from CustomResourceDefinition documents", () => {
  const stream = [
    crd("widgets.example.com"),
    "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: widgets.fake.io\n",
    crd("gadgets.example.com"),
  ].join("---\n");
  assert.deepEqual(renderedCrdNames(stream), [
    "gadgets.example.com",
    "widgets.example.com",
  ]);
});

test("a CRD name is read from top-level metadata, not from nested fields", () => {
  const nested = `kind: CustomResourceDefinition
metadata:
  labels:
    a: b
  name: "quoted.example.com"
spec:
  names:
    kind: Quoted
    name: nope
`;
  assert.deepEqual(renderedCrdNames(nested), ["quoted.example.com"]);
});

test("ownership passes when each rendered CRD is declared by exactly one owner", () => {
  assert.deepEqual(
    checkCrdOwnership([
      { name: "a", rendered: ["x.example.com"], declared: ["x.example.com"] },
      { name: "b", rendered: [], declared: [] },
    ]),
    [],
  );
});

test("ownership reports installed CRDs the catalog does not declare", () => {
  assert.deepEqual(
    checkCrdOwnership([
      {
        name: "a",
        rendered: ["x.example.com", "y.example.com"],
        declared: ["x.example.com"],
      },
    ]),
    ["a installs CRD y.example.com but does not declare it in ownsCRDs"],
  );
});

test("ownership reports declared CRDs the chart does not install", () => {
  assert.deepEqual(
    checkCrdOwnership([
      { name: "a", rendered: [], declared: ["gone.example.com"] },
    ]),
    [
      "a declares CRD gone.example.com in ownsCRDs but its chart does not install it",
    ],
  );
});

test("ownership reports a CRD installed by two components", () => {
  const errors = checkCrdOwnership([
    { name: "a", rendered: ["x.example.com"], declared: ["x.example.com"] },
    { name: "b", rendered: ["x.example.com"], declared: [] },
  ]);
  assert.ok(
    errors.includes(
      "CRD x.example.com is installed by multiple components: a and b",
    ),
  );
});

test("ownsCRDs entries must look like <plural>.<group>", () => {
  assert.deepEqual(
    crdNameFormatErrors("a", [
      "clusters.postgresql.cnpg.io",
      "shared.example",
      "Bad.Example.com",
      "nogroup",
      "trailing..dot.io",
    ]),
    [
      "a: ownsCRDs entry shared.example must look like <plural>.<group>",
      "a: ownsCRDs entry Bad.Example.com must look like <plural>.<group>",
      "a: ownsCRDs entry nogroup must look like <plural>.<group>",
      "a: ownsCRDs entry trailing..dot.io must look like <plural>.<group>",
    ],
  );
});

const owner = (
  name: string,
  ownsCRDs: string[] = [],
  ownsCRDGroups: string[] = [],
) => ({ name, ownsCRDs, ownsCRDGroups });

test("a CRD is owned by the component that names it or claims its group", () => {
  const components = [
    owner("a", ["widgets.example.com"]),
    owner("b", [], ["fn.example.io"]),
  ];
  assert.deepEqual(crdOwners(components, "widgets.example.com"), ["a"]);
  assert.deepEqual(crdOwners(components, "inputs.fn.example.io"), ["b"]);
  assert.deepEqual(crdOwners(components, "stray.other.io"), []);
});

test("a group claim matches the whole group and not its subdomains", () => {
  const components = [owner("b", [], ["example.io"])];
  assert.deepEqual(crdOwners(components, "x.sub.example.io"), []);
});

test("a component that names and claims the same CRD is one owner", () => {
  assert.deepEqual(
    crdOwners([owner("a", ["x.example.io"], ["example.io"])], "x.example.io"),
    ["a"],
  );
});

test("a CRD named by one component and claimed by another has two owners", () => {
  assert.deepEqual(
    crdOwners(
      [owner("a", ["x.example.io"]), owner("b", [], ["example.io"])],
      "x.example.io",
    ),
    ["a", "b"],
  );
});

test("group claims must be API groups", () => {
  assert.deepEqual(
    crdGroupErrors([
      owner("a", [], ["nogroup", "Bad.Example.io", "ok.example.io"]),
    ]),
    [
      "a: ownsCRDGroups entry nogroup must be an API group such as widgets.example.com",
      "a: ownsCRDGroups entry Bad.Example.io must be an API group such as widgets.example.com",
    ],
  );
});

test("two components claiming one group is an error", () => {
  assert.deepEqual(
    crdGroupErrors([
      owner("a", [], ["example.io"]),
      owner("b", [], ["example.io"]),
    ]),
    ["CRD group example.io is claimed by multiple components: a and b"],
  );
});

test("a component claiming a group that another names a CRD in is an error", () => {
  assert.deepEqual(
    crdGroupErrors([
      owner("a", ["x.example.io"]),
      owner("b", [], ["example.io"]),
    ]),
    ["CRD x.example.io is owned by a but b claims its group example.io"],
  );
});

test("a component may name CRDs inside a group it claims", () => {
  assert.deepEqual(
    crdGroupErrors([owner("a", ["x.example.io"], ["example.io"])]),
    [],
  );
});

test("a CRD is provider-owned only when its group is one the environment declares provider-owned", () => {
  const groups = { "k3s.cattle.io": "k3s ships it" };
  assert.equal(providerOwnsCrd(groups, "addons.k3s.cattle.io"), true);
  assert.equal(providerOwnsCrd(groups, "widgets.example.com"), false);
  assert.equal(providerOwnsCrd(undefined, "addons.k3s.cattle.io"), false);
});

test("a provider-owned group the provider ships, with a reason and no catalog owner, is accepted", () => {
  assert.deepEqual(
    providerCrdGroupErrors("k3d", { "k3s.cattle.io": "k3s ships it" }, []),
    [],
  );
});

test("a provider-owned group that is not an API group is rejected, with an example of one", () => {
  assert.deepEqual(providerCrdGroupErrors("k3d", { widgets: "x" }, []), [
    "environment.providerOwnedCRDGroups: widgets must be an API group such as widgets.example.com",
  ]);
});

test("a provider-owned group the provider does not ship is refused, and pointed at ownsCRDGroups", () => {
  assert.deepEqual(
    providerCrdGroupErrors("managed", { "k3s.cattle.io": "x" }, []),
    [
      "environment.providerOwnedCRDGroups: k3s.cattle.io is not shipped by managed; claim it in a catalog component with ownsCRDGroups instead",
    ],
  );
});

test("a provider-owned group must carry a reason", () => {
  assert.deepEqual(
    providerCrdGroupErrors("k3d", { "k3s.cattle.io": "  " }, []),
    ["environment.providerOwnedCRDGroups: k3s.cattle.io needs a reason"],
  );
});

test("a group that a catalog component owns by name or by claim cannot also be provider-owned", () => {
  assert.deepEqual(
    providerCrdGroupErrors("k3d", { "k3s.cattle.io": "k3s ships it" }, [
      owner("kore-b", ["addons.k3s.cattle.io"]),
      owner("kore-a", [], ["k3s.cattle.io"]),
    ]),
    [
      "environment.providerOwnedCRDGroups: k3s.cattle.io is also owned by kore-a and kore-b; a group has one owner",
    ],
  );
});
