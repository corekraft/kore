import { sha256, type ExportManifest } from "./export-manifest.js";
import type { DumpHeader } from "./backup-header.js";

/** Where the backup is stored: `interim` until the owner declares an off-host target. */
export type BackupTargetKind = "interim" | "off-host";

/**
 * The export manifest, extended with what a restore must check before it
 * decrypts: the target kind, the exact recipient list, the dump tool and the
 * PostgreSQL major the dump came from.
 */
export interface BackupManifest extends ExportManifest {
  target: { kind: BackupTargetKind };
  recipients: string[];
  dump: { tool: "pg_dump"; version: string; postgresMajor: number };
}

export interface BackupManifestInput {
  environment: string;
  createdAt: string;
  namespace: string;
  cluster: string;
  database: string;
  /** The stored object's file name, which must be a plain name. */
  file: string;
  /** The stored bytes: the manifest digests what the bucket holds, never the plaintext. */
  ciphertext: string;
  kind: BackupTargetKind;
  recipients: readonly string[];
  header: DumpHeader;
}

/** Built after the object is stored, so a manifest only ever names bytes that exist. */
export function buildBackupManifest(
  input: BackupManifestInput,
): BackupManifest {
  return {
    version: 1,
    environment: input.environment,
    createdAt: input.createdAt,
    recipient: input.recipients.join(","),
    contents: {
      kind: "cnpg-database",
      namespace: input.namespace,
      cluster: input.cluster,
      database: input.database,
      format: "pg_dump-plain",
    },
    artifact: {
      file: input.file,
      sha256: sha256(input.ciphertext),
      bytes: Buffer.byteLength(input.ciphertext),
    },
    target: { kind: input.kind },
    recipients: [...input.recipients],
    dump: {
      tool: "pg_dump",
      version: input.header.dumpVersion,
      postgresMajor: input.header.postgresMajor,
    },
  };
}
