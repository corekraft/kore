// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
// The retention rule the controller prune applies: the newest 14 daily backups per
// database prefix are kept, and every older one is selected. Pure; it deletes nothing.

/** The newest daily backups kept per database and per snapshot (ADR 0155). */
export const DAILY_RETENTION = 14;

/** A backup object's own name, the UTC stamp backupStamp writes, then the age suffix. */
const BACKUP_NAME = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)\.sql\.age$/;

/**
 * The object keys retention deletes. Backups group by their prefix (the database),
 * newest first by timestamp; each group keeps its newest `keep` and selects the
 * rest. A key without the backup layout is never selected and never counts toward
 * `keep`, so a stray file is never deleted.
 */
export function prunableBackups(
  keys: readonly string[],
  keep: number = DAILY_RETENTION,
): string[] {
  const groups = new Map<string, { key: string; stamp: string }[]>();
  for (const key of keys) {
    const slash = key.lastIndexOf("/");
    const match = BACKUP_NAME.exec(key.slice(slash + 1));
    if (slash === -1 || match === null) {
      continue;
    }
    const prefix = key.slice(0, slash);
    const group = groups.get(prefix) ?? [];
    group.push({ key, stamp: match[1]! });
    groups.set(prefix, group);
  }
  const selected: string[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => b.stamp.localeCompare(a.stamp));
    selected.push(...group.slice(keep).map(({ key }) => key));
  }
  return selected.sort();
}
