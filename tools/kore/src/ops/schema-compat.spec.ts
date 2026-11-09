import assert from "node:assert/strict";
import { test } from "vitest";
import { schemaProblems } from "./schema-compat.js";

const base = {
  type: "object",
  required: ["spec"],
  properties: {
    spec: {
      type: "object",
      required: ["size"],
      properties: {
        size: { type: "string", pattern: "^[1-9][0-9]*Gi$" },
        mode: { type: "string", enum: ["a", "b"] },
      },
    },
  },
};

const clone = (): typeof base => structuredClone(base);

test("an identical schema is compatible", () => {
  assert.deepEqual(schemaProblems(base, clone()), []);
});

test("adding an optional property or widening an enum stays compatible", () => {
  const next = clone();
  (next.properties.spec.properties as Record<string, unknown>)["extra"] = {
    type: "string",
  };
  next.properties.spec.properties.mode.enum = ["a", "b", "c"];
  assert.deepEqual(schemaProblems(base, next), []);
});

test("removing a property is reported with its path", () => {
  const next = clone();
  delete (next.properties.spec.properties as Record<string, unknown>).mode;
  assert.deepEqual(schemaProblems(base, next), ["spec.mode: property removed"]);
});

test("changing a type is reported", () => {
  const next = clone();
  next.properties.spec.properties.size.type = "integer";
  assert.match(
    schemaProblems(base, next).join(),
    /spec\.size: type changed from string to integer/,
  );
});

test("a newly required field breaks existing resources", () => {
  const next = clone();
  next.properties.spec.required = ["size", "mode"];
  assert.deepEqual(schemaProblems(base, next), [
    "spec: field mode became required",
  ]);
});

test("narrowing an enum or tightening a pattern is reported", () => {
  const next = clone();
  next.properties.spec.properties.mode.enum = ["a"];
  next.properties.spec.properties.size.pattern = "^[1-9]Gi$";
  const found = schemaProblems(base, next);
  assert.ok(found.some((p) => /spec\.mode: enum value b removed/.test(p)));
  assert.ok(found.some((p) => /spec\.size: pattern changed/.test(p)));
});
