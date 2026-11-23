import type { BackupTargetKind } from "./backup-manifest.js";
import type { S3Credentials, S3Target } from "./backup-s3.js";

export interface BackupConfig {
  target: S3Target;
  credentials: S3Credentials;
  kind: BackupTargetKind;
}

function requiredValue(
  env: NodeJS.ProcessEnv,
  name: string,
  hint: string,
): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not set; ${hint}`);
  }
  return value;
}

function endpointOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`KORE_BACKUP_ENDPOINT is not a URL: "${value}"`);
  }
}

function pathStyleOf(value: string | undefined): boolean {
  if (value !== "true" && value !== "false") {
    throw new Error('KORE_BACKUP_PATH_STYLE must be "true" or "false"');
  }
  return value === "true";
}

function kindOf(value: string): BackupTargetKind {
  if (value !== "interim" && value !== "off-host") {
    throw new Error(
      `KORE_BACKUP_KIND must be interim or off-host, not "${value}"`,
    );
  }
  return value;
}

/**
 * The target and the write credential, read from the environment the job is
 * given. Every value is checked before any dump, so a bad target fails the
 * run and touches nothing.
 */
export function backupConfigFromEnv(env: NodeJS.ProcessEnv): BackupConfig {
  const sessionToken = env["AWS_SESSION_TOKEN"];
  return {
    target: {
      endpoint: endpointOf(
        requiredValue(
          env,
          "KORE_BACKUP_ENDPOINT",
          "set the target's endpoint origin, for example https://s3.example.com",
        ),
      ),
      bucket: requiredValue(
        env,
        "KORE_BACKUP_BUCKET",
        "set the bucket the backups are written to",
      ),
      region: requiredValue(
        env,
        "KORE_BACKUP_REGION",
        "set the target's region",
      ),
      pathStyle: pathStyleOf(env["KORE_BACKUP_PATH_STYLE"]),
    },
    credentials: {
      accessKeyId: requiredValue(
        env,
        "AWS_ACCESS_KEY_ID",
        "the job needs its write-only credential from its secret",
      ),
      secretAccessKey: requiredValue(
        env,
        "AWS_SECRET_ACCESS_KEY",
        "the job needs its write-only credential from its secret",
      ),
      ...(sessionToken ? { sessionToken } : {}),
    },
    kind: kindOf(
      requiredValue(
        env,
        "KORE_BACKUP_KIND",
        "set interim or off-host, the kind every report names",
      ),
    ),
  };
}
