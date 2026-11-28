// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { expect, test } from "vitest";
import { serviceHasData } from "./service-data.js";

/** A parsed spec file whose spec carries the given fields. */
function manifest(spec: Record<string, unknown>): unknown {
  return {
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Service",
    metadata: { name: "leads" },
    spec: { organization: "platform", environments: ["vps"], ...spec },
  };
}

const claim = [
  { name: "leads-db", version: 17, size: "10Gi", retentionPolicy: "Retain" },
];

test.each([
  ["neither a database claim nor a secret name", {}, false],
  ["empty lists of both", { databases: [], secrets: [] }, false],
  ["a database claim only", { databases: claim }, true],
  ["a declared secret name only", { secrets: ["leads-api-key"] }, true],
  [
    "both a database claim and a secret name",
    { databases: claim, secrets: ["leads-api-key"] },
    true,
  ],
])("a service with %s has data: %s", (_label, spec, expected) => {
  expect(serviceHasData(manifest(spec))).toBe(expected);
});

test("a service whose databases field is present but not a list fails closed: it has data", () => {
  expect(serviceHasData(manifest({ databases: "leads-db" }))).toBe(true);
});

test("a service whose secrets field is null fails closed: it has data", () => {
  expect(serviceHasData(manifest({ secrets: null }))).toBe(true);
});

test("a record with no spec, or one that is not an object, fails closed: its data cannot be read, so it has data", () => {
  expect(serviceHasData({ apiVersion: "platform.kore.dev/v1alpha1" })).toBe(
    true,
  );
  expect(serviceHasData(undefined)).toBe(true);
  expect(serviceHasData("leads")).toBe(true);
});
