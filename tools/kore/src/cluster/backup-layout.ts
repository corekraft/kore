import { MANIFEST_SUFFIX } from "./export-manifest.js";

/** One path segment of an object name: it can never leave its prefix. */
const SEGMENT = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export interface BackupTarget {
  environment: string;
  namespace: string;
  cluster: string;
  database: string;
}

/** The object and manifest names one backup run writes, relative to the target bucket. */
export interface BackupObject {
  /** The object's key under the target bucket. */
  object: string;
  /** The object's own file name, which its manifest records. */
  file: string;
  manifest: string;
}

/** A UTC timestamp with no fraction and no colons, safe inside an object name. */
export function backupStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/:/g, "-");
}

function assertSegment(value: string, label: keyof BackupTarget): void {
  if (!SEGMENT.test(value)) {
    throw new Error(
      `invalid backup name "${value}" for ${label}: use lower-case letters, digits, "-" or "_", starting with a letter or digit`,
    );
  }
}

/**
 * One prefix per environment, namespace, cluster and database, then the
 * timestamp object and its manifest beside it (ADR 0029 manifest suffix).
 */
export function backupObject(
  target: BackupTarget,
  stamp: string,
): BackupObject {
  for (const label of [
    "environment",
    "namespace",
    "cluster",
    "database",
  ] as const) {
    assertSegment(target[label], label);
  }
  const file = `${stamp}.sql.age`;
  const object = [
    target.environment,
    target.namespace,
    target.cluster,
    target.database,
    file,
  ].join("/");
  return { object, file, manifest: `${object}${MANIFEST_SUFFIX}` };
}
