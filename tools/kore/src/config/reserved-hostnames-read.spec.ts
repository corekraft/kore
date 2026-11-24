// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md
import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { readReservedHostnames } from "./reserved-hostnames.js";

vi.mock("node:fs/promises");

const root = "/repo";
const list = `${root}/infra/catalog/reserved-hostnames.json`;
const schemaPath = `${root}/infra/catalog/schemas/reserved-hostnames.schema.json`;

const schema = JSON.stringify({
  type: "object",
  required: ["names"],
  properties: {
    names: { type: "array", items: { type: "string" } },
  },
});

/** A file that is not there, as the file system reports it. */
function enoent(): Error {
  return Object.assign(new Error("ENOENT"), { code: "ENOENT" });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readFile).mockImplementation(async (path) => {
    if (path === schemaPath) {
      return schema as never;
    }
    throw enoent();
  });
});

test("a missing reserved-name list is an error naming the file, never an empty set that lets every label through", async () => {
  expect(await readReservedHostnames(root)).toEqual({
    names: new Set(),
    errors: [
      "infra/catalog/reserved-hostnames.json: the reserved-name list is missing; restore it, it names the labels no hostname claim may take (ADR 0159)",
    ],
  });
});

test("a reserved-name list that is not strict JSON is an error naming the file", async () => {
  vi.mocked(readFile).mockImplementation(
    async (path) => (path === list ? "{ names: [" : schema) as never,
  );
  const result = await readReservedHostnames(root);
  expect(result.names).toEqual(new Set());
  expect(result.errors).toHaveLength(1);
  expect(
    result.errors[0]?.startsWith(
      "infra/catalog/reserved-hostnames.json: the reserved-name list must be strict JSON: ",
    ),
  ).toBe(true);
});

test("a readable reserved-name list gives its names, and its schema problems as errors", async () => {
  vi.mocked(readFile).mockImplementation(
    async (path) =>
      (path === list
        ? JSON.stringify({ names: ["www", "mail"] })
        : schema) as never,
  );
  expect(await readReservedHostnames(root)).toEqual({
    names: new Set(["www", "mail"]),
    errors: [],
  });
});

test("a list whose names are not an array still yields the names it holds as strings, with an error", async () => {
  vi.mocked(readFile).mockImplementation(
    async (path) =>
      (path === list ? JSON.stringify({ names: "www" }) : schema) as never,
  );
  expect(await readReservedHostnames(root)).toEqual({
    names: new Set(),
    errors: ["infra/catalog/reserved-hostnames.json: names must be an array"],
  });
});

test("a file system failure other than a missing file is not hidden", async () => {
  vi.mocked(readFile).mockRejectedValue(
    Object.assign(new Error("EACCES"), { code: "EACCES" }),
  );
  await expect(readReservedHostnames(root)).rejects.toThrow("EACCES");
});
