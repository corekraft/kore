import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { FakeRunner, useExportRepository } from "../../src/testing/index.js";
import { exportRetainedData } from "../../src/cluster/index.js";
import { backupStatus } from "../../src/platform/index.js";

// Docs: docs/operations/backups.md
// The backups row compares the newest export's recorded time with the
// retained-data RPO from infra/catalog/recovery.yaml. It reads artifact
// metadata and `kubectl get` only: no decryption, no key material, no writes.

const state = useExportRepository();
const EXPORTED = new Date("2026-11-08T00:00:00.000Z");
const minutesLater = (m: number): Date =>
  new Date(EXPORTED.getTime() + m * 60_000);

async function declareObjective(rpoMinutes = 1440): Promise<void> {
  await mkdir(join(state.root, "infra", "catalog"), { recursive: true });
  await writeFile(
    join(state.root, "infra", "catalog", "recovery.yaml"),
    JSON.stringify({
      objectives: [
        {
          name: "retained-postgresql",
          components: ["kore-postgresql-api"],
          data: "PostgreSQL",
          environment: "local",
          protection: "data-export",
          schedule: { kind: "on-demand", trigger: "kore data export" },
          rpoMinutes,
          rtoMinutes: 15,
        },
      ],
    }),
  );
}

async function exportAt(when: Date): Promise<void> {
  await exportRetainedData(state.repository, new FakeRunner(), {
    namespace: "reference",
    now: () => when,
  });
}

function clusterWith(retained: boolean): FakeRunner {
  const runner = new FakeRunner();
  runner.uncovered = retained ? "persistentvolumeclaim/data-pg-main-1\n" : "";
  return runner;
}

test("a recent export within the RPO is ready", async () => {
  await declareObjective();
  await exportAt(EXPORTED);

  const row = await backupStatus(
    state.repository,
    clusterWith(true),
    minutesLater(60),
  );

  assert.equal(row?.name, "backups");
  assert.equal(row?.status, "ready", row?.detail);
});

test("an export older than the RPO is degraded and names age, RPO, and the remedy", async () => {
  await declareObjective(1440);
  await exportAt(EXPORTED);

  const row = await backupStatus(
    state.repository,
    clusterWith(true),
    minutesLater(3000),
  );

  assert.equal(row?.status, "degraded");
  assert.match(row?.detail ?? "", /3000 minutes old/);
  assert.match(row?.detail ?? "", /1440/);
  assert.match(row?.detail ?? "", /kore data export --environment local/);
});

test("retained data with no export at all is degraded", async () => {
  await declareObjective();

  const row = await backupStatus(state.repository, clusterWith(true), EXPORTED);

  assert.equal(row?.status, "degraded");
  assert.match(row?.detail ?? "", /no export/);
  assert.match(row?.detail ?? "", /kore data export --environment local/);
});

test("no retained data is ready even without any export", async () => {
  await declareObjective();

  const row = await backupStatus(
    state.repository,
    clusterWith(false),
    EXPORTED,
  );

  assert.equal(row?.status, "ready");
  assert.match(row?.detail ?? "", /no retained data/);
});

test("an export whose artifact no longer matches its manifest does not count as fresh", async () => {
  await declareObjective();
  await exportAt(EXPORTED);
  const directory = join(state.root, ".kore", "exports", "local");
  const { readdir } = await import("node:fs/promises");
  const artifact = (await readdir(directory)).find((f) => f.endsWith(".age"));
  assert.ok(artifact);
  await writeFile(join(directory, artifact), "tampered");

  const row = await backupStatus(
    state.repository,
    clusterWith(true),
    minutesLater(1),
  );

  assert.equal(row?.status, "degraded");
});

test("the check never decrypts, writes, or mutates the cluster", async () => {
  await declareObjective();
  await exportAt(EXPORTED);
  const runner = clusterWith(true);

  await backupStatus(state.repository, runner, minutesLater(1));

  assert.ok(runner.calls.length > 0);
  for (const call of runner.calls) {
    assert.equal(call.command, "kubectl");
    assert.ok(call.args.includes("get"), call.args.join(" "));
    assert.ok(!call.args.includes("exec"));
  }
});

test("an environment with no data-export objective has no backups row", async () => {
  await mkdir(join(state.root, "infra", "catalog"), { recursive: true });
  await writeFile(
    join(state.root, "infra", "catalog", "recovery.yaml"),
    JSON.stringify({ objectives: [] }),
  );
  const runner = clusterWith(true);

  const row = await backupStatus(state.repository, runner, EXPORTED);

  assert.equal(row, undefined);
  assert.equal(runner.calls.length, 0);
});

test("an unreadable cluster reports missing, not a false ready", async () => {
  await declareObjective();
  const runner = new FakeRunner();
  runner.run = async () => {
    throw new Error("connection refused");
  };

  const row = await backupStatus(state.repository, runner, EXPORTED);

  assert.equal(row?.status, "missing");
  assert.match(row?.detail ?? "", /connection refused/);
});

test("the platform status report carries the backups row only when unfiltered", async () => {
  await declareObjective();
  const { platformStatusReport } = await import("../../src/platform/index.js");
  state.repository.catalog.components = [];

  const rows = await platformStatusReport(state.repository, clusterWith(false));
  assert.equal(rows.find((row) => row.name === "backups")?.status, "ready");

  const filtered = await platformStatusReport(
    state.repository,
    clusterWith(false),
    ["x"],
  );
  assert.ok(!filtered.some((row) => row.name === "backups"));
});
