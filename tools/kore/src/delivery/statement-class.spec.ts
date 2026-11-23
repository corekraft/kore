import { expect, test } from "vitest";
import { classifyStatement } from "./statement-class.js";

const EXPAND = { class: "expand" };
const CONTRACT = expect.objectContaining({ class: "contract" });

test("create table is an expand statement, with or without if not exists", () => {
  expect(
    classifyStatement("create table notes (id bigint, body text)"),
  ).toEqual(EXPAND);
  expect(
    classifyStatement("CREATE TABLE IF NOT EXISTS notes(id bigint)"),
  ).toEqual(EXPAND);
});

test("create table as select, unlogged and partition-of forms are contracts, because they are not on the allowlist", () => {
  expect(classifyStatement("create table copy as select * from notes")).toEqual(
    CONTRACT,
  );
  expect(classifyStatement("create unlogged table scratch (id int)")).toEqual(
    CONTRACT,
  );
});

test("add column that is nullable or has a default is an expand statement", () => {
  expect(classifyStatement("alter table notes add column title text")).toEqual(
    EXPAND,
  );
  expect(
    classifyStatement(
      "alter table notes add column done boolean not null default false",
    ),
  ).toEqual(EXPAND);
});

test("add column not null without a default is a contract", () => {
  expect(
    classifyStatement("alter table notes add column title text not null"),
  ).toEqual(CONTRACT);
});

test("add column that is generated, unique, a primary key or a reference is a contract", () => {
  for (const statement of [
    "alter table notes add column total int generated always as (a + b) stored",
    "alter table notes add column code text unique",
    "alter table notes add column id int primary key",
    "alter table notes add column owner int references people (id)",
  ]) {
    expect(classifyStatement(statement)).toEqual(CONTRACT);
  }
});

test("a multi-action alter table is a contract, even when each action is an expand", () => {
  expect(
    classifyStatement(
      "alter table notes add column title text, add column done boolean",
    ),
  ).toEqual(CONTRACT);
});

test("commas inside parentheses do not count as a second action", () => {
  expect(
    classifyStatement("alter table notes add column amount numeric(10, 2)"),
  ).toEqual(EXPAND);
});

test("a string literal that is masked by the lexer does not change the class", () => {
  expect(
    classifyStatement("alter table notes add column note text default '?'"),
  ).toEqual(EXPAND);
});

test("add constraint not valid is an expand statement", () => {
  expect(
    classifyStatement(
      "alter table notes add constraint notes_body_len check (length(body) < 10000) not valid",
    ),
  ).toEqual(EXPAND);
});

test("add constraint that is validated at once is a contract", () => {
  expect(
    classifyStatement(
      "alter table notes add constraint notes_body_len check (length(body) < 10000)",
    ),
  ).toEqual(CONTRACT);
});

test("create index concurrently that is not unique is an expand statement, named or not", () => {
  expect(
    classifyStatement("create index concurrently notes_title on notes (title)"),
  ).toEqual(EXPAND);
  expect(
    classifyStatement("create index concurrently on notes (title)"),
  ).toEqual(EXPAND);
});

test("a unique index, and a create index without concurrently, are contracts", () => {
  expect(
    classifyStatement(
      "create unique index concurrently notes_title on notes (title)",
    ),
  ).toEqual(CONTRACT);
  expect(
    classifyStatement("create index notes_title on notes (title)"),
  ).toEqual(CONTRACT);
});

test("drops, renames, type changes, not null changes and data statements are contracts", () => {
  for (const statement of [
    "drop table old_notes",
    "alter table notes drop column body",
    "alter table notes rename column body to text_body",
    "alter table notes alter column body type varchar(10)",
    "alter table notes alter column body set not null",
    "update notes set title = 'x'",
    "insert into notes (id) values (1)",
  ]) {
    expect(classifyStatement(statement)).toEqual(CONTRACT);
  }
});

test("the reason names the statement, so the author can see what to change", () => {
  expect(classifyStatement("drop table old_notes")).toEqual({
    class: "contract",
    reason: "not on the expand allowlist: drop table old_notes",
  });
});

test("a statement is trimmed, and a long one is cut to 60 characters in the reason", () => {
  const long = `drop table ${"x".repeat(100)}`;
  expect(classifyStatement(`   ${long}   `)).toEqual({
    class: "contract",
    reason: `not on the expand allowlist: ${long.slice(0, 60)}...`,
  });
});
