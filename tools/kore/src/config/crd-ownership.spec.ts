import assert from "node:assert/strict";
import { test } from "vitest";
import {
  checkCrdOwnership,
  crdNameFormatErrors,
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
