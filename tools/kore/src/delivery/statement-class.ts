// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// The static allowlist of expand DDL. Any statement not on it, and any it does not recognise, is a
// contract (fail closed).

export type StatementClass =
  { class: "expand" } | { class: "contract"; reason: string };

const SNIPPET_LENGTH = 60;
// Keywords that make an ADD COLUMN something other than nullable or with a default.
const NOT_PLAIN_COLUMN = [
  "generated",
  "unique",
  "primary",
  "references",
  "check",
  "identity",
  "exclude",
];

/** Classifies one statement, as the lexer splits it. The reason names the statement when it is a contract. */
export function classifyStatement(statement: string): StatementClass {
  if (isExpand(normalise(statement))) {
    return { class: "expand" };
  }
  const shown = statement.replace(/\s+/g, " ").trim();
  const cut =
    shown.length > SNIPPET_LENGTH
      ? `${shown.slice(0, SNIPPET_LENGTH)}...`
      : shown;
  return { class: "contract", reason: `not on the expand allowlist: ${cut}` };
}

/** Lowercase, with parentheses and commas as their own tokens and single spaces between tokens. */
function normalise(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/([(),])/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function isExpand(statement: string): boolean {
  return (
    isCreateTable(statement) ||
    isCreateIndexConcurrently(statement) ||
    isExpandAlter(statement)
  );
}

/** CREATE TABLE with a column list, not a CREATE TABLE ... AS or a partition of. */
function isCreateTable(statement: string): boolean {
  return /^create table (if not exists )?\S+ \( .*\)$/.test(statement);
}

/** CREATE INDEX CONCURRENTLY that is not unique; the name is optional. */
function isCreateIndexConcurrently(statement: string): boolean {
  return /^create index concurrently (if not exists )?(\S+ )?on /.test(
    statement,
  );
}

/** An ALTER TABLE with exactly one action, which is ADD COLUMN or ADD CONSTRAINT NOT VALID. */
function isExpandAlter(statement: string): boolean {
  const match = /^alter table (if exists )?(only )?\S+ (.+)$/.exec(statement);
  if (match === null) {
    return false;
  }
  const action = match[3] ?? "";
  if (topLevelCommas(action) > 0) {
    return false;
  }
  return isExpandAddColumn(action) || isExpandAddConstraint(action);
}

/** ADD COLUMN that is nullable, or has a default; a generated, unique, key or reference column is not. */
function isExpandAddColumn(action: string): boolean {
  const match = /^add column (if not exists )?\S+ (.+)$/.exec(action);
  if (match === null) {
    return false;
  }
  const tokens = (match[2] ?? "").split(" ");
  if (tokens.some((token) => NOT_PLAIN_COLUMN.includes(token))) {
    return false;
  }
  const notNull = tokens.some(
    (token, index) => token === "not" && tokens[index + 1] === "null",
  );
  return !notNull || tokens.includes("default");
}

/** ADD CONSTRAINT that is not validated at once, as NOT VALID. */
function isExpandAddConstraint(action: string): boolean {
  return /^add constraint \S+ .+ not valid$/.test(action);
}

/** The commas outside parentheses, which separate the actions of one ALTER TABLE. */
function topLevelCommas(text: string): number {
  let depth = 0;
  let commas = 0;
  for (const token of text.split(" ")) {
    if (token === "(") {
      depth++;
    } else if (token === ")") {
      depth--;
    } else if (token === "," && depth === 0) {
      commas++;
    }
  }
  return commas;
}
