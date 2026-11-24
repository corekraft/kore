// Docs: infra/plans/14-test-tiers.md (the kore-backup program, spec #1610)
// The entrypoint the backup image runs. It holds no shell: pg_dump and age are
// spawned directly, plaintext stays in memory, and the process prints the object
// and manifest names it wrote, never the dump or the credential.
import { parseArgs } from "node:util";
import { ProcessRunner, type Runner } from "../runtime/index.js";
import { backupConfigFromEnv } from "./backup-config.js";
import { runBackup, type BackupOutcome } from "./backup-run.js";
import { s3ObjectStore } from "./backup-s3.js";
import { dumpDatabase, encryptDump } from "./backup-tools.js";

export interface BackupProgramInput {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  runner: Runner;
  now: Date;
}

function requiredFlag(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

/** Runs one backup as the flags and environment describe it. */
export async function backupProgram(
  input: BackupProgramInput,
): Promise<BackupOutcome> {
  const { values } = parseArgs({
    args: [...input.argv],
    options: {
      environment: { type: "string" },
      namespace: { type: "string" },
      cluster: { type: "string" },
      database: { type: "string" },
      recipient: { type: "string", multiple: true },
      "drill-recipient": { type: "string" },
      canary: { type: "boolean" },
    },
    strict: true,
  });
  const job = {
    environment: requiredFlag(values.environment, "environment"),
    namespace: requiredFlag(values.namespace, "namespace"),
    cluster: requiredFlag(values.cluster, "cluster"),
    database: requiredFlag(values.database, "database"),
  };
  // The target is checked before anything is dumped, so a bad one touches nothing.
  const config = backupConfigFromEnv(input.env);
  const { runner } = input;
  return await runBackup(
    {
      dump: (database) => dumpDatabase(runner, database),
      encrypt: (recipients, plaintext) =>
        encryptDump(runner, recipients, plaintext),
      store: s3ObjectStore({
        target: config.target,
        credentials: config.credentials,
      }),
    },
    {
      ...job,
      kind: config.kind,
      canary: values.canary ?? false,
      recipients: values.recipient ?? [],
      drillRecipient: values["drill-recipient"],
      now: input.now,
    },
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  backupProgram({
    argv: process.argv.slice(2),
    env: process.env,
    runner: new ProcessRunner(),
    now: new Date(),
  })
    .then((outcome) => {
      console.log(JSON.stringify(outcome));
    })
    .catch((error: unknown) => {
      console.error(
        `error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}
