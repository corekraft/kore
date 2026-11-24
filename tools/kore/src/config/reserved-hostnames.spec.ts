// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md
import { expect, test } from "vitest";
import {
  reservedCoverageErrors,
  reservedListErrors,
  type SchemaNode,
} from "./reserved-hostnames.js";

const file = "infra/catalog/reserved-hostnames.json";

/** The list's shape, as the catalog schema states it: an object of names, nothing else. */
const schema: SchemaNode = {
  type: "object",
  required: ["names"],
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    names: {
      type: "array",
      items: {
        type: "string",
        pattern: "^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$",
      },
    },
  },
};

test("a well-formed list of reserved names has no problems", () => {
  expect(reservedListErrors(file, { names: ["www", "mail"] }, schema)).toEqual(
    [],
  );
});

test("a list that is not an object with names is refused as malformed, naming the file", () => {
  const errors = reservedListErrors(file, { names: "www" }, schema);
  expect(errors.length).toBeGreaterThan(0);
  for (const error of errors) {
    expect(error.startsWith(`${file}: `)).toBe(true);
  }
});

test("a name that is not a lowercase DNS label is refused, naming the file", () => {
  expect(reservedListErrors(file, { names: ["Bad_Name"] }, schema)).toEqual([
    `${file}: names[0] must match ^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$`,
  ]);
});

test("a name repeated in the list is refused, naming the repeat", () => {
  expect(reservedListErrors(file, { names: ["www", "www"] }, schema)).toEqual([
    `${file}: names repeats "www": remove the repeat`,
  ]);
});

test("a reserved name the app model reserves for suborgs and the list lacks is refused", () => {
  expect(
    reservedCoverageErrors(file, new Set(["www"]), ["argocd", "www"]),
  ).toEqual([
    `${file}: names is missing "argocd", a suborg name the app model reserves (ADR 0165): add it, so no hostname claim takes a suborg's name`,
  ]);
});

test("a list that holds every name the app model reserves for suborgs has no coverage problem", () => {
  expect(
    reservedCoverageErrors(file, new Set(["argocd", "www", "mail"]), [
      "argocd",
      "www",
    ]),
  ).toEqual([]);
});
