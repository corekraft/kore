// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// The release rules for migrations: a normal release carries expand only, a contract ships alone as
// a data contract or a code contract, and migrations are append-only. Pure over the diff.
import type { ContractDeclaration } from "./contract-trailers.js";
import type { MigrationFile } from "./migration-file.js";
import { MIGRATIONS_PATH, TEST_PATHS } from "./migration-paths.js";

export interface MigrationChange {
  /** git's status letter: A added, M modified, D deleted, T type changed. Renames are not shown. */
  status: string;
  path: string;
}

export type PlanRelease = "none" | "expand" | "data-contract" | "code-contract";

export interface MigrationEntry {
  path: string;
  class: "expand" | "contract";
}

export interface ContractSummary {
  lastUsed: string;
  soakHours: number;
  retiredFlags: string[];
}

export interface ReviewInput {
  declaration: ContractDeclaration | undefined;
  changes: MigrationChange[];
  changedPaths: string[];
  /** Every migration file the release adds under migrations/, classified. */
  added: MigrationFile[];
  newFlags: string[];
  retiredFlags: string[];
}

export interface MigrationReview {
  failures: string[];
  release: PlanRelease;
  migrations: MigrationEntry[];
  contract: ContractSummary | null;
  /** True when the N-1 check must run: the release adds a migration and is not a code contract. */
  needsN1: boolean;
}

/** Applies the migration rules to one release. A failure refuses it; a pass yields its plan. */
export function migrationReview(input: ReviewInput): MigrationReview {
  const failures = appendOnlyFailures(input.changes);
  const added = [...input.added].sort((a, b) => compare(a.path, b.path));
  const declaration = input.declaration;
  if (declaration === undefined) {
    return normalRelease(failures, added);
  }
  if (declaration.kind === "data") {
    return dataContract(failures, declaration, input, added);
  }
  return codeContract(failures, declaration, input);
}

function appendOnlyFailures(changes: MigrationChange[]): string[] {
  return changes
    .filter((change) => isMigration(change.path) && change.status !== "A")
    .map(
      (change) =>
        `migration ${change.path} was ${change.status === "D" ? "deleted" : "modified"}; migrations are append-only, so add a new file instead`,
    );
}

function normalRelease(
  failures: string[],
  added: MigrationFile[],
): MigrationReview {
  for (const file of added) {
    if (file.class === "contract") {
      failures.push(
        `migration ${file.path} is a contract (${file.reason}); a normal release carries only expand migrations, so a contract ships alone in its own release`,
      );
    }
  }
  const releases = added.length > 0;
  return {
    failures,
    release: releases ? "expand" : "none",
    migrations: entries(added),
    contract: null,
    needsN1: releases,
  };
}

function dataContract(
  failures: string[],
  declaration: ContractDeclaration,
  input: ReviewInput,
  added: MigrationFile[],
): MigrationReview {
  if (added.length === 0) {
    failures.push(
      "a data contract carries contract migrations, and this release adds none under migrations/",
    );
  }
  for (const file of added) {
    if (file.class === "expand") {
      failures.push(
        `migration ${file.path} is an expand migration; a data contract carries contract migrations only`,
      );
    }
  }
  const outside = input.changedPaths.filter(
    (path) => !isMigration(path) && !isTest(path),
  );
  if (outside.length > 0) {
    failures.push(
      `a data contract touches only migrations/ and tests; these changed paths are not: ${outside.join(", ")}`,
    );
  }
  return {
    failures,
    release: "data-contract",
    migrations: entries(added),
    contract: {
      lastUsed: declaration.lastUsed,
      soakHours: declaration.soakHours,
      retiredFlags: [],
    },
    needsN1: added.length > 0,
  };
}

function codeContract(
  failures: string[],
  declaration: ContractDeclaration,
  input: ReviewInput,
): MigrationReview {
  const addedMigrations = input.changes
    .filter((change) => change.status === "A" && isMigration(change.path))
    .map((change) => change.path);
  if (addedMigrations.length > 0) {
    failures.push(
      `a code contract touches no migration; these are added: ${addedMigrations.join(", ")}`,
    );
  }
  if (input.retiredFlags.length === 0) {
    failures.push(
      "a code contract retires a flag, and no flag in the base manifest is absent at head",
    );
  }
  if (input.newFlags.length > 0) {
    failures.push(
      `a code contract adds no flag; these flags are new: ${input.newFlags.join(", ")}`,
    );
  }
  return {
    failures,
    release: "code-contract",
    migrations: [],
    contract: {
      lastUsed: declaration.lastUsed,
      soakHours: declaration.soakHours,
      retiredFlags: [...input.retiredFlags].sort(compare),
    },
    needsN1: false,
  };
}

function entries(files: MigrationFile[]): MigrationEntry[] {
  return files.map((file) => ({ path: file.path, class: file.class }));
}

function isMigration(path: string): boolean {
  return path.startsWith(MIGRATIONS_PATH);
}

function isTest(path: string): boolean {
  return TEST_PATHS.some((pattern) => pattern.test(path));
}

/** Orders paths by code point, so the plan's order never depends on the locale. */
function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
