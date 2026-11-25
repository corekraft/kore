// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
// The controller's retention enforcement for a target that cannot enforce it itself.
// It lists the environment's backups with the read credential, selects the ones past
// the newest 14 per database, asks for consent on a terminal, and only then removes
// them with the delete credential. The box never runs it: both credentials live in
// the controller's documents, and the job holds only the write-only one.
import { join } from "node:path";
import { featureEnabled, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { credentialFromDocument } from "./backup-credentials.js";
import { DAILY_RETENTION, prunableBackups } from "./backup-retention.js";
import type { ObjectAdmin } from "./backup-s3-admin.js";
import type { S3Credentials } from "./backup-s3.js";
import { MANIFEST_SUFFIX } from "./export-manifest.js";

export interface PruneOptions {
  runner: Runner;
  /** The target's admin, built for one credential: the read one lists, the delete one removes. */
  admin: (credentials: S3Credentials) => ObjectAdmin;
  /** Asks the operator on a terminal; undefined where there is no terminal to ask on. */
  confirm: ((question: string) => Promise<boolean>) | undefined;
  /** True inside a job or a pod, where prune never runs. */
  inCluster: boolean;
}

export interface PruneReport {
  status: "pruned" | "nothing-to-prune";
  bucket: string;
  /** The object keys removed; each one's manifest was removed before it. */
  deleted: string[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A controller-held credential document. It sits beside the applied secrets and is never applied. */
function controllerDocument(
  root: string,
  environment: string,
  name: string,
): string {
  return join(
    root,
    "infra/environments",
    environment,
    "controller-secrets",
    `${name}.enc.yaml`,
  );
}

/** Decrypts one controller credential into memory: sops writes it to stdout, captured, never to disk. */
async function controllerCredentials(
  runner: Runner,
  root: string,
  environment: string,
  name: string,
): Promise<S3Credentials> {
  const path = controllerDocument(root, environment, name);
  let text: string;
  try {
    text = (
      await runner.run("sops", ["--decrypt", "--output-type", "json", path], {
        capture: true,
      })
    ).stdout;
  } catch (error) {
    throw new Error(
      `could not decrypt ${path}: ${errorText(error)}; check that SOPS_AGE_KEY_FILE holds this environment's age identity and that the document exists, then rerun kore backup prune`,
    );
  }
  return credentialFromDocument(text, name, path).credentials;
}

/** Lists the environment's backups with the read credential; a refused listing names the rerun, and nothing was deleted. */
async function listBackups(
  admin: ObjectAdmin,
  environment: string,
): Promise<string[]> {
  try {
    return await admin.list(`${environment}/`);
  } catch (error) {
    throw new Error(
      `${errorText(error)}; then rerun kore backup prune --environment ${environment}`,
    );
  }
}

/** Removes each backup's manifest, then its object, so a manifest never names bytes that are gone. */
async function removeAll(
  admin: ObjectAdmin,
  keys: readonly string[],
  environment: string,
): Promise<void> {
  for (const [done, key] of keys.entries()) {
    try {
      await admin.remove(`${key}${MANIFEST_SUFFIX}`);
      await admin.remove(key);
    } catch (error) {
      throw new Error(
        `${errorText(error)}; ${done} of ${keys.length} backups were pruned before this; rerun kore backup prune --environment ${environment} to finish`,
      );
    }
  }
}

/**
 * Prunes one environment's backups as the controller. Every refusal comes before any
 * credential is read, so a refused run touches nothing. The delete credential is
 * decrypted only after consent, and a run that selects nothing never reads it.
 */
export async function pruneBackups(
  repository: Repository,
  options: PruneOptions,
): Promise<PruneReport> {
  const { environment, root } = repository;
  const declared = environment.backup;
  if (declared === undefined) {
    throw new Error(
      `no backup.target is declared for ${environment.name}, so there is nothing to prune; declare it in the overlay (ADR 0155)`,
    );
  }
  if (!featureEnabled(environment, "database-backups")) {
    throw new Error(
      `database-backups is off in ${environment.name}; backup prune runs only where that flag is on, so nothing was read or deleted (ADR 0155)`,
    );
  }
  if (options.inCluster) {
    throw new Error(
      "backup prune never runs from a job or a pod; run it from the controller's terminal, where the delete credential is held (ADR 0155)",
    );
  }
  if (options.confirm === undefined) {
    throw new Error(
      "backup prune needs a terminal to ask for consent; run it in a terminal, nothing was deleted",
    );
  }
  const { target } = declared;
  const secret = target.credentials.secret;
  const read = await controllerCredentials(
    options.runner,
    root,
    environment.name,
    `${secret}-read`,
  );
  const listed = await listBackups(options.admin(read), environment.name);
  const selected = prunableBackups(listed);
  if (selected.length === 0) {
    return { status: "nothing-to-prune", bucket: target.bucket, deleted: [] };
  }
  const question = `Delete ${selected.length} backup object(s) from ${target.bucket} at ${target.endpoint}, keeping the newest ${DAILY_RETENTION} per database? Type y to delete: `;
  if (!(await options.confirm(question))) {
    throw new Error("backup prune was not confirmed; nothing was deleted");
  }
  const remover = options.admin(
    await controllerCredentials(
      options.runner,
      root,
      environment.name,
      `${secret}-delete`,
    ),
  );
  await removeAll(remover, selected, environment.name);
  return { status: "pruned", bucket: target.bucket, deleted: selected };
}
