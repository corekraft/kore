import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { exportRetainedData, restoreRetainedData } from "../cluster/index.js";
import { findRoot } from "../config/index.js";
import { loadRepository, type Repository } from "../config/index.js";
import {
  ProcessRunner,
  type Runner,
  liveEnvironment,
} from "../runtime/index.js";
import { loadRecovery } from "./recovery.js";

const NAMESPACE = "reference";
const CLUSTER = "reference-db";
const MARKER_TABLE = "kore_ops_restore_marker";

const missing = (): string | false => {
  if (process.env["KORE_RUN_LIVE"] !== "1") {
    return "set KORE_RUN_LIVE=1 to opt into a live cluster";
  }
  return process.env["KORE_OPS_AGE_IDENTITY"]
    ? false
    : "set KORE_OPS_AGE_IDENTITY to the path of your age identity file (Kore passes the path to age and never reads the key)";
};

type Psql = (sql: string) => Promise<string>;

/**
 * Runs SQL in the reference database primary over the pod's local socket, with
 * the repository's configured context. It never reads a Secret value.
 */
async function connect(repository: Repository, runner: Runner): Promise<Psql> {
  const kubectl = (args: string[]): Promise<{ stdout: string }> =>
    runner.run(
      "kubectl",
      [
        "--context",
        repository.environment.kubeContext,
        "--namespace",
        NAMESPACE,
        ...args,
      ],
      { capture: true, cwd: repository.root },
    );
  const primary = (
    await kubectl([
      "get",
      "pods",
      `--selector=cnpg.io/cluster=${CLUSTER},cnpg.io/instanceRole=primary`,
      "--output=jsonpath={.items[0].metadata.name}",
    ])
  ).stdout.trim();
  assert.notEqual(primary, "", `${CLUSTER} must have a primary pod`);
  return async (sql) =>
    (
      await kubectl([
        "exec",
        primary,
        "--container=postgres",
        "--",
        "psql",
        "--dbname=app",
        "--tuples-only",
        "--no-align",
        `--command=${sql}`,
      ])
    ).stdout.trim();
}

/** Exports the reference database, then restores it over a dropped marker table. */
async function exportAndRestore(
  repository: Repository,
  runner: Runner,
  psql: Psql,
  files: string[],
): Promise<void> {
  const { exports } = await exportRetainedData(repository, runner, {
    namespace: NAMESPACE,
  });
  const entry = exports.find((candidate) => candidate.cluster === CLUSTER);
  assert.ok(entry, `an export of ${CLUSTER} was written`);
  const directory = join(
    repository.root,
    ".kore",
    "exports",
    repository.environment.name,
  );
  files.push(join(directory, entry.artifact), join(directory, entry.manifest));
  await psql(`DROP TABLE ${MARKER_TABLE}`);
  await restoreRetainedData(repository, runner, {
    from: entry.artifact,
    identity: process.env["KORE_OPS_AGE_IDENTITY"]!,
    overwriteData: true,
    yes: true,
  });
}

/**
 * Proves the `retained-postgresql` objective in infra/catalog/recovery.yaml on
 * a live profile: write a marker, export, destroy the marker, restore, read the
 * marker back, and finish inside the declared RTO. It needs `kore local up` to
 * have run first, and it cleans up its table and its export files.
 */
test(
  "retained PostgreSQL restores from a Kore export inside its recovery time objective",
  { concurrency: false, skip: missing() },
  async () => {
    const root = await findRoot();
    const repository = await loadRepository(liveEnvironment(), root);
    const runner: Runner = new ProcessRunner();
    const objective = (await loadRecovery(root)).find(
      (candidate) => candidate.name === "retained-postgresql",
    );
    assert.ok(objective, "retained-postgresql objective is declared");
    const psql = await connect(repository, runner);
    const marker = randomUUID();
    const files: string[] = [];
    try {
      await psql(`CREATE TABLE ${MARKER_TABLE} (marker text NOT NULL)`);
      await psql(`INSERT INTO ${MARKER_TABLE} VALUES ('${marker}')`);
      const started = Date.now();
      await exportAndRestore(repository, runner, psql, files);
      const elapsedMinutes = (Date.now() - started) / 60_000;
      assert.equal(
        await psql(`SELECT marker FROM ${MARKER_TABLE}`),
        marker,
        "the restored database holds the marker written before the export",
      );
      assert.ok(
        elapsedMinutes <= objective.rtoMinutes,
        `export and restore took ${elapsedMinutes.toFixed(1)} min, over the ${objective.rtoMinutes} min objective`,
      );
    } finally {
      await psql(`DROP TABLE IF EXISTS ${MARKER_TABLE}`);
      await Promise.all(files.map((file) => rm(file, { force: true })));
    }
  },
);
