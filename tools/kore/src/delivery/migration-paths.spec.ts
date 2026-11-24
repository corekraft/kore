import { expect, test } from "vitest";
import { MIGRATIONS_PATH, TEST_PATHS } from "./migration-paths.js";

const isTest = (path: string) =>
  TEST_PATHS.some((pattern) => pattern.test(path));

test("the migrations live under migrations/ at the app root, the one path the eval reads", () => {
  expect(MIGRATIONS_PATH).toBe("migrations/");
});

test("a test path is a tests or __tests__ directory, or a spec or test file", () => {
  expect(isTest("tests/notes.spec.ts")).toBe(true);
  expect(isTest("src/__tests__/notes.ts")).toBe(true);
  expect(isTest("src/notes.test.mjs")).toBe(true);
});

test("docs, source and the flags manifest are never test paths, so a data contract may not touch them", () => {
  expect(isTest("docs/notes.md")).toBe(false);
  expect(isTest("src/app.ts")).toBe(false);
  expect(isTest("flags.yaml")).toBe(false);
});
