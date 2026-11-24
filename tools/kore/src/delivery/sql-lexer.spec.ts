import { expect, test } from "vitest";
import { splitStatements } from "./sql-lexer.js";

test("statements are split on top-level semicolons and trimmed, with empty ones dropped", () => {
  expect(
    splitStatements(
      "create table a (id int);\n\n  create table b (id int);\n;\n",
    ),
  ).toEqual({
    statements: ["create table a (id int)", "create table b (id int)"],
  });
});

test("a semicolon inside a string literal or a quoted identifier does not end the statement", () => {
  expect(splitStatements("select 'a;b', \"x;y\" from t;")).toEqual({
    statements: ["select '?', \"?\" from t"],
  });
});

test("a doubled quote inside a string literal is an escape, not the end of the string", () => {
  expect(splitStatements("select 'it''s; fine' from t;")).toEqual({
    statements: ["select '?' from t"],
  });
});

test("line and block comments are removed, so a semicolon in one does not split", () => {
  expect(
    splitStatements(
      "-- drop everything; really\ncreate table t (id int) /* a ; b */;",
    ),
  ).toEqual({ statements: ["create table t (id int)"] });
});

test("nested block comments are removed as a whole, as PostgreSQL reads them", () => {
  expect(splitStatements("/* a /* b */ ; */ select 1")).toEqual({
    statements: ["select 1"],
  });
});

test("a dollar sign that is not a dollar quote, such as a parameter, is ordinary text", () => {
  expect(splitStatements("select $1 from a$b")).toEqual({
    statements: ["select $1 from a$b"],
  });
});

test("an unterminated string literal fails the split, so the file cannot be classified", () => {
  expect(splitStatements("select 'abc;")).toEqual({
    error: "an unterminated string literal",
  });
});

test("an unterminated quoted identifier fails the split", () => {
  expect(splitStatements('select "abc')).toEqual({
    error: "an unterminated quoted identifier",
  });
});

test("an unterminated block comment fails the split", () => {
  expect(splitStatements("select 1 /* open")).toEqual({
    error: "an unterminated block comment",
  });
});

test("a dollar-quoted body fails the split, because its contents are not read", () => {
  expect(splitStatements("do $$ begin null; end $$;")).toEqual({
    error: "a dollar-quoted body, which the classifier does not read",
  });
});

test("an E-prefixed string with backslash escapes fails the split", () => {
  expect(splitStatements("select E'a\\'b;' ;")).toEqual({
    error: "an E'' escape string, which the classifier does not read",
  });
});

test("an empty file has no statements", () => {
  expect(splitStatements("  \n")).toEqual({ statements: [] });
});
