// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { beforeEach, expect, test, vi } from "vitest";
import { newestVerifiedExport, retainedResources } from "../cluster/index.js";
import type { Repository } from "../config/index.js";
import { loadRecovery } from "../ops/index.js";
import type { Runner } from "../runtime/index.js";
import { backupStatus } from "./backup-status.js";
import { errorMessage } from "./probe.js";

vi.mock("../cluster/index.js");
vi.mock("../ops/index.js");
vi.mock("./probe.js");

// Docs: docs/operations/backups.md, docs/decisions/0074-backup-freshness-row.md

type Recovery = Awaited<ReturnType<typeof loadRecovery>>;

const NOW = new Date("2026-11-14T12:00:00Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

const repository = {
  root: "/repo",
  environment: { name: "local" },
} as unknown as Repository;
const runner = {} as Runner;

/** A recovery catalog with the given data-export objectives. */
function recovery(
  ...objectives: { environment: string; rpoMinutes: number | null }[]
): Recovery {
  return objectives.map((objective) => ({
    protection: "data-export",
    ...objective,
  })) as unknown as Recovery;
}

beforeEach(() => {
  vi.mocked(loadRecovery).mockResolvedValue(
    recovery({ environment: "local", rpoMinutes: 60 }),
  );
  vi.mocked(retainedResources).mockResolvedValue(["postgres/orders"]);
  vi.mocked(newestVerifiedExport).mockResolvedValue(minutesAgo(30));
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
});

test("an environment with no data-export objective gets no backup row and reads no retained data", async () => {
  vi.mocked(loadRecovery).mockResolvedValue(recovery());

  expect(await backupStatus(repository, runner, NOW)).toBeUndefined();

  expect(retainedResources).not.toHaveBeenCalled();
});

test("an objective with no RPO is not an objective, so the row is absent", async () => {
  vi.mocked(loadRecovery).mockResolvedValue(
    recovery({ environment: "local", rpoMinutes: null }),
  );

  expect(await backupStatus(repository, runner, NOW)).toBeUndefined();
});

test("a non-local environment is judged by the managed objective, not the local one", async () => {
  vi.mocked(loadRecovery).mockResolvedValue(
    recovery(
      { environment: "local", rpoMinutes: 60 },
      { environment: "managed", rpoMinutes: 240 },
    ),
  );
  const managed = {
    ...repository,
    environment: { name: "prod" },
  } as unknown as Repository;

  const row = await backupStatus(managed, runner, NOW);

  expect(row?.backup).toEqual({ rpoMinutes: 240, ageMinutes: 30 });
});

test("a failure listing retained data is missing, naming the error", async () => {
  vi.mocked(retainedResources).mockRejectedValue(new Error("forbidden"));

  expect(await backupStatus(repository, runner, NOW)).toEqual({
    name: "backups",
    namespace: "cluster",
    status: "missing",
    detail: "retained data could not be listed: forbidden",
  });
  expect(newestVerifiedExport).not.toHaveBeenCalled();
});

test("with no retained data there is nothing to back up, so the row is ready and no export is read", async () => {
  vi.mocked(retainedResources).mockResolvedValue([]);

  expect(await backupStatus(repository, runner, NOW)).toEqual({
    name: "backups",
    namespace: "cluster",
    status: "ready",
    detail: "no retained data exists, so nothing needs a backup",
    backup: { rpoMinutes: 60, ageMinutes: null },
  });
  expect(newestVerifiedExport).not.toHaveBeenCalled();
});

test("retained data with no verified export is degraded and names the export command and the RPO", async () => {
  vi.mocked(newestVerifiedExport).mockResolvedValue(undefined);

  expect(await backupStatus(repository, runner, NOW)).toEqual({
    name: "backups",
    namespace: "cluster",
    status: "degraded",
    detail:
      "retained data exists but there is no export; the RPO is 60 minutes. Run kore data export --environment local",
    backup: { rpoMinutes: 60, ageMinutes: null },
  });
});

test("an export newer than the RPO is ready and reports its age", async () => {
  vi.mocked(newestVerifiedExport).mockResolvedValue(minutesAgo(30));

  expect(await backupStatus(repository, runner, NOW)).toEqual({
    name: "backups",
    namespace: "cluster",
    status: "ready",
    detail: "the newest export is 30 minutes old (RPO 60 minutes)",
    backup: { rpoMinutes: 60, ageMinutes: 30 },
  });
});

test("an export exactly the RPO old is still ready: only older than the RPO is degraded", async () => {
  vi.mocked(newestVerifiedExport).mockResolvedValue(minutesAgo(60));

  const row = await backupStatus(repository, runner, NOW);

  expect(row?.status).toBe("ready");
  expect(row?.backup?.ageMinutes).toBe(60);
});

test("an export older than the RPO is degraded, naming the age, the RPO and the export command", async () => {
  vi.mocked(newestVerifiedExport).mockResolvedValue(minutesAgo(90));

  expect(await backupStatus(repository, runner, NOW)).toEqual({
    name: "backups",
    namespace: "cluster",
    status: "degraded",
    detail:
      "the newest export is 90 minutes old, older than the 60-minute RPO. Run kore data export --environment local",
    backup: { rpoMinutes: 60, ageMinutes: 90 },
  });
});

test("age counts whole minutes, so 89 minutes and 59 seconds is 89 minutes old", async () => {
  vi.mocked(newestVerifiedExport).mockResolvedValue(
    new Date(NOW.getTime() - (89 * 60 + 59) * 1000),
  );

  const row = await backupStatus(repository, runner, NOW);

  expect(row?.backup?.ageMinutes).toBe(89);
});

test("an export stamped after now is clamped to age zero, never a negative age", async () => {
  vi.mocked(newestVerifiedExport).mockResolvedValue(
    new Date(NOW.getTime() + 5 * 60_000),
  );

  const row = await backupStatus(repository, runner, NOW);

  expect(row?.backup?.ageMinutes).toBe(0);
  expect(row?.detail).toBe(
    "the newest export is 0 minutes old (RPO 60 minutes)",
  );
});
