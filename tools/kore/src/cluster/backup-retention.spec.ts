import { expect, test } from "vitest";
import { DAILY_RETENTION, prunableBackups } from "./backup-retention.js";

const PREFIX = "vps/golden-path/pg-main/app";
const PLATFORM = "vps/kore-system/pg-platform/keycloak";

/** The object key of the daily backup taken on one November day at 02:00 UTC. */
function backupOn(day: number, prefix = PREFIX): string {
  const dd = String(day).padStart(2, "0");
  return `${prefix}/2026-11-${dd}T02-00-00Z.sql.age`;
}

/** Sixteen daily backups, days 1 to 16, in the order they were taken. */
function sixteenDays(prefix = PREFIX): string[] {
  return Array.from({ length: 16 }, (_, index) => backupOn(index + 1, prefix));
}

test("the retention keeps the newest 14 daily backups per database", () => {
  expect(DAILY_RETENTION).toBe(14);
  expect(prunableBackups(sixteenDays())).toEqual([backupOn(1), backupOn(2)]);
});

test("a database with 14 or fewer backups selects nothing", () => {
  const fourteen = sixteenDays().slice(2);
  expect(prunableBackups(fourteen)).toEqual([]);
});

test("it selects by timestamp, never by the order the listing returns them", () => {
  const shuffled = [...sixteenDays()].reverse();
  expect(prunableBackups(shuffled)).toEqual([backupOn(1), backupOn(2)]);
});

test("retention counts each database on its own, so one database never prunes another", () => {
  const platform = Array.from({ length: 15 }, (_, index) =>
    backupOn(index + 1, PLATFORM),
  );
  expect(prunableBackups([...sixteenDays(), ...platform])).toEqual([
    backupOn(1),
    backupOn(2),
    backupOn(1, PLATFORM),
  ]);
});

test("nothing newer than the kept backups is ever selected", () => {
  const selected = prunableBackups(sixteenDays());
  for (const key of selected) {
    expect(key < backupOn(3)).toBe(true);
  }
  expect(selected).not.toContain(backupOn(16));
});

test("a key that does not carry the backup layout is never selected and does not count toward the 14", () => {
  const stray = [
    `${PREFIX}/notes.txt`,
    `${PREFIX}/2026-11-01T02-00-00Z.sql.age.manifest.json`,
    `${PREFIX}/latest`,
  ];
  expect(prunableBackups([...sixteenDays().slice(2), ...stray])).toEqual([]);
});
