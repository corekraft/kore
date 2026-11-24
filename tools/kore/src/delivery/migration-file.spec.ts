import { beforeEach, expect, test, vi } from "vitest";
import { classifyMigrationFile } from "./migration-file.js";
import { splitStatements } from "./sql-lexer.js";
import { classifyStatement } from "./statement-class.js";

// The file rule is the unit: the lexer and the statement classifier are mocked, so these tests
// observe how one file's verdict follows from them (ADR 0098).
vi.mock("./sql-lexer.js");
vi.mock("./statement-class.js");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(splitStatements).mockReturnValue({
    statements: ["create table a (id int)"],
  });
  vi.mocked(classifyStatement).mockReturnValue({ class: "expand" });
});

test("a .sql file whose every statement is expand is an expand migration, with no reason", () => {
  expect(
    classifyMigrationFile(
      "migrations/0002-add-note.sql",
      "create table a (id int);",
    ),
  ).toEqual({ path: "migrations/0002-add-note.sql", class: "expand" });
});

test("a file that is not .sql is a contract, and its text is not read", () => {
  expect(
    classifyMigrationFile("migrations/0003-seed.ts", "export {};"),
  ).toEqual({
    path: "migrations/0003-seed.ts",
    class: "contract",
    reason: "not a .sql file",
  });
  expect(splitStatements).not.toHaveBeenCalled();
});

test("a file the lexer cannot read is a contract, named by the lexer's reason", () => {
  vi.mocked(splitStatements).mockReturnValue({
    error: "an unterminated string literal",
  });
  expect(classifyMigrationFile("migrations/0004.sql", "select 'x")).toEqual({
    path: "migrations/0004.sql",
    class: "contract",
    reason: "an unterminated string literal",
  });
  expect(classifyStatement).not.toHaveBeenCalled();
});

test("a file with no statements is a contract, because it has nothing to classify as expand", () => {
  vi.mocked(splitStatements).mockReturnValue({ statements: [] });
  expect(classifyMigrationFile("migrations/0005.sql", "-- nothing")).toEqual({
    path: "migrations/0005.sql",
    class: "contract",
    reason: "no statements",
  });
});

test("a file is a contract when any one statement is, and the reason is that statement's", () => {
  vi.mocked(splitStatements).mockReturnValue({
    statements: ["create table a (id int)", "drop table old"],
  });
  vi.mocked(classifyStatement)
    .mockReturnValueOnce({ class: "expand" })
    .mockReturnValueOnce({
      class: "contract",
      reason: "not on the expand allowlist: drop table old",
    });
  expect(classifyMigrationFile("migrations/0006.sql", "...")).toEqual({
    path: "migrations/0006.sql",
    class: "contract",
    reason: "not on the expand allowlist: drop table old",
  });
});
