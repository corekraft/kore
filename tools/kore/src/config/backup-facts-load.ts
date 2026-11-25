// Reads the gate facts of one environment from its spec files (ADR 0155). Read-only:
// it reads the services directory and contacts no cluster. Loaded only while
// database-backups is on and the overlay declares a backup target, so a flag-off
// load reads no file.
// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { backupFacts, type ServiceFactRecord } from "./backup-facts.js";
import type { BackupFacts, Environment } from "./types.js";

const specSuffix = ".json";
const releaseSuffix = ".release.json";

/**
 * The gate facts of an environment, or undefined while database-backups is off or no
 * backup target is declared (there is no kind to publish).
 */
export async function loadBackupFacts(
  root: string,
  environment: Environment,
): Promise<BackupFacts | undefined> {
  const target = environment.backup?.target;
  if (
    environment.features?.["database-backups"] !== true ||
    target === undefined
  ) {
    return undefined;
  }
  const directory = join(
    root,
    "infra/environments",
    environment.name,
    "services",
  );
  return backupFacts(target.kind, await readRecords(directory));
}

/** The spec records of a services directory; an absent directory holds no services. */
async function readRecords(directory: string): Promise<ServiceFactRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw unreadable(directory, error);
  }
  const records: ServiceFactRecord[] = [];
  for (const entry of entries.sort()) {
    if (
      entry.startsWith(".") ||
      !entry.endsWith(specSuffix) ||
      entry.endsWith(releaseSuffix)
    ) {
      continue;
    }
    records.push({
      name: entry.slice(0, -specSuffix.length),
      manifest: await readManifest(join(directory, entry)),
    });
  }
  return records;
}

/**
 * The parsed spec file, or undefined when it is not JSON: kore validate reports the
 * parse error, and the fact fails closed meanwhile.
 */
async function readManifest(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw unreadable(path, error);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** An error naming the path that cannot be read and the fix, with the cause kept for the reader. */
function unreadable(path: string, cause: unknown): Error {
  return new Error(
    `${path} is unreadable (${String(cause)}); restore read access to the environment's service records, or turn database-backups off until they can be read (ADR 0155)`,
    { cause },
  );
}
