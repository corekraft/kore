// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
import { splitStatements } from "./sql-lexer.js";
import { classifyStatement } from "./statement-class.js";

export type MigrationFile =
  | { path: string; class: "expand" }
  | { path: string; class: "contract"; reason: string };

/**
 * One migration file is one migration. It is expand only when it is a .sql file whose every
 * statement is on the expand allowlist; any other file is a contract, and its reason says why.
 */
export function classifyMigrationFile(
  path: string,
  text: string,
): MigrationFile {
  if (!path.endsWith(".sql")) {
    return contract(path, "not a .sql file");
  }
  const split = splitStatements(text);
  if ("error" in split) {
    return contract(path, split.error);
  }
  if (split.statements.length === 0) {
    return contract(path, "no statements");
  }
  for (const statement of split.statements) {
    const result = classifyStatement(statement);
    if (result.class === "contract") {
      return contract(path, result.reason);
    }
  }
  return { path, class: "expand" };
}

function contract(path: string, reason: string): MigrationFile {
  return { path, class: "contract", reason };
}
