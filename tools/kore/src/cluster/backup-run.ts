import { backupObject, backupStamp } from "./backup-layout.js";
import {
  buildBackupManifest,
  type BackupTargetKind,
} from "./backup-manifest.js";
import { backupRecipients } from "./backup-recipients.js";
import type { ObjectStore } from "./backup-s3.js";
import type { DumpResult } from "./backup-tools.js";

export interface BackupJob {
  environment: string;
  namespace: string;
  cluster: string;
  database: string;
  kind: BackupTargetKind;
  canary: boolean;
  /** The vps sops recipient and the recovery recipient, in that order. */
  recipients: readonly string[];
  drillRecipient?: string | undefined;
  now: Date;
}

/** The side effects, each injected so a run is testable without a cluster or a bucket. */
export interface BackupDeps {
  dump: (database: string) => Promise<DumpResult>;
  encrypt: (
    recipients: readonly string[],
    plaintext: string,
  ) => Promise<string>;
  store: ObjectStore;
}

export interface BackupOutcome {
  object: string;
  manifest: string;
}

/**
 * One backup: dump, encrypt, store the object, then store its manifest. The
 * config is checked before anything is dumped. A failed stage stops the run,
 * and the manifest is written only once the object is stored, so a manifest
 * never names bytes that are not there.
 */
export async function runBackup(
  deps: BackupDeps,
  job: BackupJob,
): Promise<BackupOutcome> {
  const recipients = backupRecipients({
    canary: job.canary,
    recipients: job.recipients,
    drillRecipient: job.drillRecipient,
  });
  const names = backupObject(
    {
      environment: job.environment,
      namespace: job.namespace,
      cluster: job.cluster,
      database: job.database,
    },
    backupStamp(job.now),
  );
  const dump = await deps.dump(job.database);
  const ciphertext = await deps.encrypt(recipients, dump.plaintext);
  const manifest = buildBackupManifest({
    environment: job.environment,
    createdAt: job.now.toISOString(),
    namespace: job.namespace,
    cluster: job.cluster,
    database: job.database,
    file: names.file,
    ciphertext,
    kind: job.kind,
    recipients,
    header: dump.header,
  });
  await deps.store.put(
    names.object,
    Buffer.from(ciphertext),
    "application/octet-stream",
  );
  await deps.store.put(
    names.manifest,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    "application/json",
  );
  return { object: names.object, manifest: names.manifest };
}
