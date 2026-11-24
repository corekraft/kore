import { expect, test } from "vitest";
import type { ContractDeclaration } from "./contract-trailers.js";
import { migrationReview, type ReviewInput } from "./migration-rules.js";

// The rules are pure: they take the changes and the classified files, so no dependency is mocked.
const expandFile = (path: string) => ({ path, class: "expand" as const });
const contractFile = (path: string, reason: string) => ({
  path,
  class: "contract" as const,
  reason,
});

const DATA: ContractDeclaration = {
  kind: "data",
  lastUsed: "1.2.2+def5678",
  soakHours: 24,
};
const CODE: ContractDeclaration = {
  kind: "code",
  lastUsed: "1.2.2+def5678",
  soakHours: 6,
};

/** A release with nothing changed: every rule reads an empty diff unless a test sets it. */
const release = (overrides: Partial<ReviewInput> = {}): ReviewInput => ({
  declaration: undefined,
  changes: [],
  changedPaths: [],
  added: [],
  newFlags: [],
  retiredFlags: [],
  ...overrides,
});

test("a normal release with no migration has an empty plan, needs no N-1 check, and fails nothing", () => {
  expect(migrationReview(release({ changedPaths: ["src/app.ts"] }))).toEqual({
    failures: [],
    release: "none",
    migrations: [],
    contract: null,
    needsN1: false,
  });
});

test("a normal release whose added migrations are all expand is an expand release, listed by path, and needs the N-1 check", () => {
  const review = migrationReview(
    release({
      changes: [
        { status: "A", path: "migrations/0003-add-tag.sql" },
        { status: "A", path: "migrations/0002-add-note.sql" },
      ],
      added: [
        expandFile("migrations/0003-add-tag.sql"),
        expandFile("migrations/0002-add-note.sql"),
      ],
    }),
  );
  expect(review).toEqual({
    failures: [],
    release: "expand",
    migrations: [
      { path: "migrations/0002-add-note.sql", class: "expand" },
      { path: "migrations/0003-add-tag.sql", class: "expand" },
    ],
    contract: null,
    needsN1: true,
  });
});

test("a contract migration in a normal release is refused, naming the file and the statement that made it a contract", () => {
  const review = migrationReview(
    release({
      changes: [{ status: "A", path: "migrations/0004-drop.sql" }],
      added: [
        contractFile(
          "migrations/0004-drop.sql",
          "not on the expand allowlist: drop table old",
        ),
      ],
    }),
  );
  expect(review.failures).toEqual([
    "migration migrations/0004-drop.sql is a contract (not on the expand allowlist: drop table old); a normal release carries only expand migrations, so a contract ships alone in its own release",
  ]);
});

test("a migration that is modified, renamed away or deleted is refused, since migrations are append-only", () => {
  const review = migrationReview(
    release({
      changes: [
        { status: "M", path: "migrations/0001-init.sql" },
        { status: "D", path: "migrations/0002-old.sql" },
        { status: "T", path: "migrations/0003-type.sql" },
        { status: "M", path: "src/app.ts" },
      ],
    }),
  );
  expect(review.failures).toEqual([
    "migration migrations/0001-init.sql was modified; migrations are append-only, so add a new file instead",
    "migration migrations/0002-old.sql was deleted; migrations are append-only, so add a new file instead",
    "migration migrations/0003-type.sql was modified; migrations are append-only, so add a new file instead",
  ]);
});

test("a data contract of contract migrations touching only migrations and tests is a pass, with its declared window", () => {
  const review = migrationReview(
    release({
      declaration: DATA,
      changes: [
        { status: "A", path: "migrations/0005-drop-old.sql" },
        { status: "M", path: "tests/notes.spec.ts" },
      ],
      changedPaths: ["migrations/0005-drop-old.sql", "tests/notes.spec.ts"],
      added: [
        contractFile(
          "migrations/0005-drop-old.sql",
          "not on the expand allowlist: drop table old",
        ),
      ],
    }),
  );
  expect(review).toEqual({
    failures: [],
    release: "data-contract",
    migrations: [
      {
        path: "migrations/0005-drop-old.sql",
        class: "contract",
      },
    ],
    contract: { lastUsed: "1.2.2+def5678", soakHours: 24, retiredFlags: [] },
    needsN1: true,
  });
});

test("a data contract that adds no migration is refused, because it would carry nothing", () => {
  expect(
    migrationReview(release({ declaration: DATA, changedPaths: [] })).failures,
  ).toEqual([
    "a data contract carries contract migrations, and this release adds none under migrations/",
  ]);
});

test("a data contract may not carry an expand migration", () => {
  expect(
    migrationReview(
      release({
        declaration: DATA,
        changes: [{ status: "A", path: "migrations/0006-add.sql" }],
        changedPaths: ["migrations/0006-add.sql"],
        added: [expandFile("migrations/0006-add.sql")],
      }),
    ).failures,
  ).toEqual([
    "migration migrations/0006-add.sql is an expand migration; a data contract carries contract migrations only",
  ]);
});

test("a data contract may touch only migrations and tests: the flags manifest, source and docs are refused by name", () => {
  const review = migrationReview(
    release({
      declaration: DATA,
      changes: [{ status: "A", path: "migrations/0005-drop-old.sql" }],
      changedPaths: [
        "flags.yaml",
        "migrations/0005-drop-old.sql",
        "src/app.ts",
        "docs/notes.md",
        "tests/notes.spec.ts",
      ],
      added: [contractFile("migrations/0005-drop-old.sql", "drop")],
    }),
  );
  expect(review.failures).toEqual([
    "a data contract touches only migrations/ and tests; these changed paths are not: flags.yaml, src/app.ts, docs/notes.md",
  ]);
});

test("a code contract with no migration and a retired flag is a pass, with the retired flags sorted", () => {
  const review = migrationReview(
    release({
      declaration: CODE,
      changedPaths: ["src/checkout.ts", "flags.yaml"],
      retiredFlags: ["leads.zeta", "leads.alpha"],
    }),
  );
  expect(review).toEqual({
    failures: [],
    release: "code-contract",
    migrations: [],
    contract: {
      lastUsed: "1.2.2+def5678",
      soakHours: 6,
      retiredFlags: ["leads.alpha", "leads.zeta"],
    },
    needsN1: false,
  });
});

test("a code contract may not add a migration", () => {
  expect(
    migrationReview(
      release({
        declaration: CODE,
        changes: [{ status: "A", path: "migrations/0007.sql" }],
        changedPaths: ["migrations/0007.sql"],
        added: [expandFile("migrations/0007.sql")],
        retiredFlags: ["leads.old"],
      }),
    ).failures,
  ).toEqual([
    "a code contract touches no migration; these are added: migrations/0007.sql",
  ]);
});

test("a code contract must retire a flag that the base manifest declares and the head does not", () => {
  expect(
    migrationReview(release({ declaration: CODE, changedPaths: ["src/a.ts"] }))
      .failures,
  ).toEqual([
    "a code contract retires a flag, and no flag in the base manifest is absent at head",
  ]);
});

test("a code contract may not add a flag, since it only removes one", () => {
  expect(
    migrationReview(
      release({
        declaration: CODE,
        retiredFlags: ["leads.old"],
        newFlags: ["leads.new"],
      }),
    ).failures,
  ).toEqual(["a code contract adds no flag; these flags are new: leads.new"]);
});
