import { expect, test } from "vitest";
import { schemaErrors } from "./schema-subset.js";

test("a value that matches its schema has no errors", () => {
  const schema = {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  };
  expect(schemaErrors(schema, { name: "leads" }, "spec")).toEqual([]);
});

test("a missing required field is reported by its full path", () => {
  const schema = {
    type: "object",
    required: ["organization"],
    properties: { organization: { type: "string" } },
  };
  expect(schemaErrors(schema, {}, "spec")).toEqual([
    "spec.organization is required",
  ]);
});

test("a value of the wrong type names the path and the type it must be", () => {
  const schema = {
    type: "object",
    properties: { gateway: { type: "string" }, secrets: { type: "array" } },
  };
  expect(schemaErrors(schema, { gateway: 1, secrets: "x" }, "spec")).toEqual([
    "spec.gateway must be a string",
    "spec.secrets must be an array",
  ]);
});

test("an object where a scalar is expected is reported, never walked into", () => {
  const schema = { type: "object", properties: { name: { type: "string" } } };
  expect(schemaErrors(schema, { name: { nested: true } }, "spec")).toEqual([
    "spec.name must be a string",
  ]);
});

test("a key the schema does not declare is refused, and the message names the fields that are allowed", () => {
  const schema = {
    type: "object",
    properties: { organization: { type: "string" }, path: { type: "string" } },
  };
  expect(
    schemaErrors(schema, { organization: "platform", flags: {} }, "spec"),
  ).toEqual([
    "spec.flags is not a field of this record; the fields here are organization, path",
  ]);
});

test("an unknown key is refused at every depth of an object that declares properties", () => {
  const schema = {
    type: "object",
    properties: {
      components: {
        type: "object",
        properties: { frontend: { type: "object", properties: {} } },
      },
    },
  };
  expect(
    schemaErrors(schema, { components: { frontend: { digest: "x" } } }, "spec"),
  ).toEqual([
    "spec.components.frontend.digest is not a field of this record; the fields here are none",
  ]);
});

test("a caller can replace the unknown-field message for a key it recognises", () => {
  const schema = {
    type: "object",
    properties: { organization: { type: "string" } },
  };
  const messages = schemaErrors(schema, { digest: "sha256:0" }, "spec", {
    unknownField: (path, key) =>
      key === "digest" ? `${path} belongs to the release file` : undefined,
  });
  expect(messages).toEqual(["spec.digest belongs to the release file"]);
});

test("an object schema without properties accepts any keys, so a reserved field can hold any object", () => {
  const schema = {
    type: "object",
    "x-kubernetes-preserve-unknown-fields": true,
  };
  expect(
    schemaErrors(schema, { anything: { goes: 1 } }, "spec.backup"),
  ).toEqual([]);
});

test("a pattern failure names the field, the pattern and the field's description", () => {
  const schema = {
    type: "object",
    properties: {
      digest: {
        type: "string",
        pattern: "^sha256:[0-9a-f]{64}$",
        description:
          "the image digest, sha256 then 64 lowercase hex characters",
      },
    },
  };
  expect(schemaErrors(schema, { digest: "sha256:abc" }, "release")).toEqual([
    "release.digest must match ^sha256:[0-9a-f]{64}$ (the image digest, sha256 then 64 lowercase hex characters)",
  ]);
});

test("const and enum accept only their listed value", () => {
  const schema = {
    type: "object",
    properties: {
      kind: { const: "Service" },
      gateway: { type: "string", enum: ["internal", "external"] },
    },
  };
  expect(
    schemaErrors(schema, { kind: "Deployment", gateway: "public" }, "record"),
  ).toEqual([
    'record.kind must be "Service"',
    "record.gateway must be one of internal, external",
  ]);
});

test("length, item and property-count limits are enforced", () => {
  const schema = {
    type: "object",
    properties: {
      commit: { type: "string", minLength: 40, maxLength: 40 },
      components: { type: "object", minProperties: 1 },
      secrets: { type: "array", maxItems: 2, items: { type: "string" } },
    },
  };
  expect(
    schemaErrors(
      schema,
      { commit: "abc", components: {}, secrets: ["a", "b", "c"] },
      "spec",
    ),
  ).toEqual([
    "spec.commit must be at least 40 characters",
    "spec.components must have at least 1 field",
    "spec.secrets must have at most 2 items",
  ]);
});

test("items are checked one by one, each by its index", () => {
  const schema = {
    type: "object",
    properties: { hostnames: { type: "array", items: { type: "string" } } },
  };
  expect(schemaErrors(schema, { hostnames: ["a", 2] }, "spec")).toEqual([
    "spec.hostnames[1] must be a string",
  ]);
});

test("a $ref to a definition in the same schema is followed", () => {
  const schema = {
    type: "object",
    properties: { frontend: { $ref: "#/$defs/component" } },
    $defs: {
      component: {
        type: "object",
        required: ["digest"],
        properties: { digest: { type: "string" } },
      },
    },
  };
  expect(schemaErrors(schema, { frontend: {} }, "release")).toEqual([
    "release.frontend.digest is required",
  ]);
});

test("integer and number are told apart, and a string shorter than minLength is named", () => {
  const schema = {
    type: "object",
    properties: {
      replicas: { type: "integer" },
      weight: { type: "number" },
      name: { type: "string", minLength: 3 },
    },
  };
  expect(
    schemaErrors(schema, { replicas: 1.5, weight: 2.5, name: "ab" }, "spec"),
  ).toEqual([
    "spec.replicas must be an integer",
    "spec.name must be at least 3 characters",
  ]);
});
