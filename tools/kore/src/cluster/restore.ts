import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { assertExpectedCluster } from "./cluster.js";
import { execArgs, retainedClusters } from "./export-cluster.js";
import {
  MANIFEST_SUFFIX,
  assertExportFileName,
  verifyManifest,
} from "./export-manifest.js";

export interface RestoreOptions {
  /** Artifact file name inside the environment's export directory. */
  from: string;
  /** Path handed to `age --identity`; age reads it, Kore never does. */
  identity?: string;
  overwriteData: boolean;
  yes: boolean;
  env?: NodeJS.ProcessEnv;
}

// Recreate `public` exactly as PostgreSQL 15+ creates it: owned by the
// database owner (the application role) with USAGE for everyone. A bare
// CREATE SCHEMA would make it postgres-owned, and the app could no longer
// create tables in its own database.
const REPLACE_SCHEMA = [
  "DROP SCHEMA IF EXISTS public CASCADE;",
  "CREATE SCHEMA public AUTHORIZATION pg_database_owner;",
  "GRANT USAGE ON SCHEMA public TO PUBLIC;",
  "",
].join("\n");

async function targetPrimary(
  repository: Repository,
  runner: Runner,
  namespace: string,
  cluster: string,
): Promise<string> {
  const target = (await retainedClusters(repository, runner, namespace)).find(
    (candidate) => candidate.name === cluster,
  );
  if (!target) {
    throw new Error(
      `cluster ${cluster} not found in namespace ${namespace}; bring the platform and reference app up first (kore local up)`,
    );
  }
  if (!target.primary) {
    throw new Error(`cluster ${cluster} has no primary yet; wait until ready`);
  }
  return target.primary;
}

async function tableCount(
  repository: Repository,
  runner: Runner,
  target: { namespace: string; primary: string; cluster: string },
  database: string,
): Promise<number> {
  const count = await runner.run(
    "kubectl",
    execArgs(repository, target.namespace, target.primary, { stdin: false }, [
      "psql",
      "--dbname",
      database,
      "--tuples-only",
      "--no-align",
      "--command",
      "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')",
    ]),
    { capture: true },
  );
  const tables = Number.parseInt(count.stdout.trim(), 10);
  if (!Number.isInteger(tables)) {
    throw new Error(
      `could not read the table count of ${database} in ${target.cluster}: ${count.stdout.trim() || "empty output"}`,
    );
  }
  return tables;
}

/**
 * Restores a verified export into the matching cluster of a fresh profile.
 * A database that already holds tables is left alone unless the caller opts
 * in to replacing it.
 */
export async function restoreRetainedData(
  repository: Repository,
  runner: Runner,
  options: RestoreOptions,
): Promise<{ restored: true; cluster: string; database: string }> {
  assertExportFileName(options.from);
  const verified = await verifyManifest(
    repository,
    `${options.from}${MANIFEST_SUFFIX}`,
  );
  if (!verified || verified.manifest.artifact.file !== options.from) {
    throw new Error(
      `export ${options.from} is missing, belongs to another environment, or does not match its manifest digest; re-export before restoring`,
    );
  }
  const identity =
    options.identity ?? (options.env ?? process.env)["SOPS_AGE_KEY_FILE"];
  if (!identity) {
    throw new Error(
      "restore needs your age identity: pass --identity <path to your age key file> or set SOPS_AGE_KEY_FILE; Kore passes the path to age and never reads the key",
    );
  }
  if (options.overwriteData && !options.yes) {
    throw new Error(
      "--overwrite-data replaces the existing database and requires --yes",
    );
  }
  const { namespace, cluster, database } = verified.manifest.contents;
  await assertExpectedCluster(repository, runner);
  const primary = await targetPrimary(repository, runner, namespace, cluster);
  const tables = await tableCount(
    repository,
    runner,
    { namespace, primary, cluster },
    database,
  );
  if (tables > 0 && !options.overwriteData) {
    throw new Error(
      `database ${database} in ${cluster} is not empty (${tables} tables); restore targets a fresh profile. Repeat with --overwrite-data --yes to replace it`,
    );
  }
  const decrypted = await runner.run(
    "age",
    ["--decrypt", "--identity", identity],
    { capture: true, input: verified.artifact },
  );
  await runner.run(
    "kubectl",
    execArgs(repository, namespace, primary, { stdin: true }, [
      "psql",
      "--dbname",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "--single-transaction",
      "--file",
      "-",
    ]),
    {
      capture: true,
      input:
        tables > 0 ? `${REPLACE_SCHEMA}${decrypted.stdout}` : decrypted.stdout,
    },
  );
  return { restored: true, cluster, database };
}
