// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { expect, test } from "vitest";
import {
  backedUpDatabases,
  databaseBackupErrors,
  type DatabaseEntry,
} from "./database-backup.js";

const file = "infra/environments/vps/services/leads.json";

/** A database entry with the fields a record writes; a test sets the ones it checks. */
function entry(
  fields: Partial<DatabaseEntry> & { name: string },
): DatabaseEntry {
  return {
    version: 17,
    size: "10Gi",
    retentionPolicy: "Retain",
    ...fields,
  };
}

/** A parsed spec file that declares the given databases. */
function manifest(databases: unknown): unknown {
  return {
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Service",
    metadata: { name: "leads" },
    spec: { organization: "platform", environments: ["vps"], databases },
  };
}

test("a database that is not opted in is not backed up, and a silent one is not either", () => {
  const databases = [
    entry({ name: "leads-db", backup: false }),
    entry({ name: "reports-db" }),
  ];
  expect(backedUpDatabases({ databases })).toEqual([]);
});

test("a database that opts in with backup true is backed up, and nothing else of the record is", () => {
  const leads = entry({ name: "leads-db", backup: true });
  const reports = entry({ name: "reports-db", backup: false });
  expect(backedUpDatabases({ databases: [leads, reports] })).toEqual([leads]);
});

test("a platform-owned database is backed up without an opt-in, as Keycloak's is", () => {
  const keycloak = entry({ name: "keycloak-db" });
  expect(backedUpDatabases({ databases: [keycloak] })).toEqual([keycloak]);
});

test("a record with no database entry has no database backed up", () => {
  expect(backedUpDatabases({})).toEqual([]);
});

test("a Retain database with backup off is accepted, with or without a backup target", () => {
  const databases = [entry({ name: "leads-db", backup: false })];
  expect(
    databaseBackupErrors({
      file,
      manifest: manifest(databases),
      backupTargetDeclared: false,
    }),
  ).toEqual([]);
  expect(
    databaseBackupErrors({
      file,
      manifest: manifest(databases),
      backupTargetDeclared: true,
    }),
  ).toEqual([]);
});

test("a record with no databases, or a silent database, is accepted: silence is never an error", () => {
  expect(
    databaseBackupErrors({
      file,
      manifest: manifest(undefined),
      backupTargetDeclared: false,
    }),
  ).toEqual([]);
  expect(
    databaseBackupErrors({
      file,
      manifest: manifest([entry({ name: "leads-db" })]),
      backupTargetDeclared: false,
    }),
  ).toEqual([]);
});

test("a Retain database with backup true and a declared backup target is accepted", () => {
  expect(
    databaseBackupErrors({
      file,
      manifest: manifest([entry({ name: "leads-db", backup: true })]),
      backupTargetDeclared: true,
    }),
  ).toEqual([]);
});

test("backup true on a Delete claim is refused, saying a disposable claim cannot also be protected", () => {
  expect(
    databaseBackupErrors({
      file,
      manifest: manifest([
        entry({
          name: "leads-db",
          backup: true,
          retentionPolicy: "Delete",
        }),
      ]),
      backupTargetDeclared: true,
    }),
  ).toEqual([
    `${file}: database leads-db sets backup: true with retentionPolicy: Delete; a claim declared disposable cannot also be protected: set retentionPolicy: Retain, or backup: false (ADR 0155)`,
  ]);
});

test("backup true with no backup target in the overlay is refused, naming the database and the fix", () => {
  expect(
    databaseBackupErrors({
      file,
      manifest: manifest([entry({ name: "leads-db", backup: true })]),
      backupTargetDeclared: false,
    }),
  ).toEqual([
    `${file}: database leads-db sets backup: true, but the overlay declares no backup.target, so there is nowhere to back it up: declare backup.target in the environment overlay, or set backup: false (ADR 0155)`,
  ]);
});

test("a Delete claim with backup true and no target reports both refusals", () => {
  const errors = databaseBackupErrors({
    file,
    manifest: manifest([
      entry({ name: "leads-db", backup: true, retentionPolicy: "Delete" }),
    ]),
    backupTargetDeclared: false,
  });
  expect(errors).toHaveLength(2);
});

test("a manifest that is not a record, or whose spec is not one, has no database rules to run", () => {
  expect(
    databaseBackupErrors({
      file,
      manifest: "not a record",
      backupTargetDeclared: false,
    }),
  ).toEqual([]);
  expect(
    databaseBackupErrors({
      file,
      manifest: { spec: null },
      backupTargetDeclared: false,
    }),
  ).toEqual([]);
});

test("a database entry that is not an object is skipped, leaving the schema to name it", () => {
  expect(
    databaseBackupErrors({
      file,
      manifest: manifest(["leads-db"]),
      backupTargetDeclared: false,
    }),
  ).toEqual([]);
});
