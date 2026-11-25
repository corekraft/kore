// The backup opt-in of a service's database entries (ADR 0155): which databases of a
// record are backed up, and the refusals kore validate makes of a backup: on a claim
// declared disposable, and with no backup target in the overlay to hold it. Pure: the
// caller reads the record and says whether the overlay declares a target. The public
// surface of this domain exports backedUpDatabases, the one source later tickets read.
// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md

/** A database entry of a service spec: the fields its PostgreSQL claim is rendered from, and the opt-in. */
export interface DatabaseEntry {
  name: string;
  /** The PostgreSQL major, 16, 17 or 18. */
  version: number;
  /** The storage size, a whole number of Gi. */
  size: string;
  /** The claim's retention; Delete claims are disposable and cannot be backed up. */
  retentionPolicy: "Delete" | "Retain";
  /** The opt-in: unset is off, and silence is never an error (ADR 0155). */
  backup?: boolean;
}

/** The part of a service spec the backup rules read. */
export interface ServiceDatabases {
  databases?: readonly DatabaseEntry[];
}

/**
 * The databases the platform owns, always backed up without an opt-in (ADR 0155).
 * Keycloak's claim is keycloak-db (infra/charts/platform-keycloak). A later platform
 * database is added here by name.
 */
export const platformOwnedDatabases: readonly string[] = ["keycloak-db"];

/**
 * The databases of a record that are backed up: each that opts in with backup
 * true, and each the platform owns. Every other database, silent or off, is not.
 */
export function backedUpDatabases(spec: ServiceDatabases): DatabaseEntry[] {
  return (spec.databases ?? []).filter(
    (database) =>
      database.backup === true ||
      platformOwnedDatabases.includes(database.name),
  );
}

export interface DatabaseBackupInput {
  /** The spec file's repository path, for the messages. */
  file: string;
  /** The parsed spec file; a manifest that is not a record has no database rules. */
  manifest: unknown;
  /** Whether the environment overlay declares a backup.target (ADR 0155). */
  backupTargetDeclared: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The database entries the spec declares that are objects with a name; the schema reports the rest. */
function declaredEntries(manifest: unknown): Record<string, unknown>[] {
  const spec = isRecord(manifest) ? manifest.spec : undefined;
  const databases = isRecord(spec) ? spec.databases : undefined;
  if (!Array.isArray(databases)) {
    return [];
  }
  return databases.filter(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && typeof entry.name === "string",
  );
}

/**
 * The refusals of a database's backup opt-in. Only an explicit backup: true is
 * checked: a Delete claim cannot be protected, and a backup needs a target in the
 * overlay to be written to. Silence and backup false are never refused.
 */
export function databaseBackupErrors(input: DatabaseBackupInput): string[] {
  const { file, manifest, backupTargetDeclared } = input;
  const errors: string[] = [];
  for (const entry of declaredEntries(manifest)) {
    if (entry.backup !== true) {
      continue;
    }
    const name = String(entry.name);
    if (entry.retentionPolicy === "Delete") {
      errors.push(
        `${file}: database ${name} sets backup: true with retentionPolicy: Delete; a claim declared disposable cannot also be protected: set retentionPolicy: Retain, or backup: false (ADR 0155)`,
      );
    }
    if (!backupTargetDeclared) {
      errors.push(
        `${file}: database ${name} sets backup: true, but the overlay declares no backup.target, so there is nowhere to back it up: declare backup.target in the environment overlay, or set backup: false (ADR 0155)`,
      );
    }
  }
  return errors;
}
