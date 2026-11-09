import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clusterDestroy } from "../cluster/index.js";
import { findRoot } from "../config/config.js";
import { loadRepository, type Repository } from "../config/index.js";
import { assertReferenceSmoke } from "../platform/platform.reference-smoke.integration.spec.js";
import { platformStatus } from "../platform/index.js";
import { ProcessRunner } from "../runtime/index.js";
import { stopLocalTunnel } from "../tunnel/index.js";
import { checkoutRelease, releaseKore, removeRelease } from "./release-tree.js";
import { schemaProblems } from "./schema-compat.js";
import { previousRelease, upgradeCheck } from "./upgrade.js";

// Docs: docs/operations/support-and-upgrades.md
// Live: proves the supported upgrade path (Step 15). It destroys and purges the
// local profile, installs the platform and reference app with the previous
// release tag's own built CLI and catalog (a detached git worktree outside the
// repository), writes a marker row into the retained reference database, then
// upgrades with this working tree's `kore local up` and checks that every
// component is ready, the reference app still serves, the marker survived, and
// the application contract (the PostgreSQLInstance XRD schema) did not change.
// It ends on the working-tree state and removes the worktree, so it is safe to
// rerun. Set KORE_UPGRADE_FROM=<tag> to override the newest v* tag.
// Run with: npm run test:integration:upgrade (sets KORE_RUN_INTEGRATION=1).

const NAMESPACE = "reference";
const CLUSTER = "reference-db";
const XRD = "postgresqlinstances.platform.kore.dev";
const TABLE = "kore_upgrade_marker";

function kubectl(repository: Repository, ...args: string[]): string[] {
  return ["--context", repository.environment.kubeContext, ...args];
}

async function psql(
  repository: Repository,
  runner: ProcessRunner,
  sql: string,
): Promise<string> {
  const run = (args: string[]) =>
    runner.run(
      "kubectl",
      kubectl(repository, "--namespace", NAMESPACE, ...args),
      {
        capture: true,
        cwd: repository.root,
      },
    );
  const primary = (
    await run([
      "get",
      "pods",
      `--selector=cnpg.io/cluster=${CLUSTER},cnpg.io/instanceRole=primary`,
      "--output=jsonpath={.items[0].metadata.name}",
    ])
  ).stdout.trim();
  assert.notEqual(primary, "", `${CLUSTER} must have a primary pod`);
  return (
    await run([
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

async function contractSchema(
  repository: Repository,
  runner: ProcessRunner,
): Promise<Record<string, unknown>> {
  const { stdout } = await runner.run(
    "kubectl",
    kubectl(repository, "get", "crd", XRD, "--output=json"),
    { capture: true, cwd: repository.root },
  );
  const versions = (
    JSON.parse(stdout) as {
      spec: {
        versions: { name: string; schema: { openAPIV3Schema: unknown } }[];
      };
    }
  ).spec.versions;
  return Object.fromEntries(
    versions.map((version) => [version.name, version.schema.openAPIV3Schema]),
  );
}

async function assertAllReady(
  repository: Repository,
  runner: ProcessRunner,
): Promise<void> {
  const names = repository.catalog.components.map(
    (component) => component.name,
  );
  const rows = await platformStatus(repository, runner, names);
  assert.equal(rows.length, names.length, "every catalog component reports");
  const notReady = rows.filter((row) => row.status !== "ready");
  assert.deepEqual(
    notReady.map((row) => `${row.name}: ${row.status} (${row.detail})`),
    [],
    "every component must be ready",
  );
}

async function assertUpgraded(
  repository: Repository,
  runner: ProcessRunner,
  marker: string,
  before: Record<string, unknown>,
): Promise<void> {
  await assertAllReady(repository, runner);
  await assertReferenceSmoke(repository, runner);
  assert.equal(
    await psql(repository, runner, `SELECT marker FROM ${TABLE}`),
    marker,
    "retained application data must survive the upgrade",
  );
  const after = await contractSchema(repository, runner);
  for (const [version, schema] of Object.entries(before)) {
    assert.deepEqual(
      schemaProblems(schema, after[version]),
      [],
      `application contract ${version} must not change incompatibly`,
    );
  }
}

test(
  "a supported upgrade from the previous release keeps the reference app, its data, and the application contract",
  {
    concurrency: false,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live platform"
        : false,
    timeout: 90 * 60 * 1000,
  },
  async () => {
    const root = await findRoot();
    const repository = await loadRepository("local", root);
    const runner = new ProcessRunner();
    const from =
      process.env["KORE_UPGRADE_FROM"] ?? (await previousRelease(runner, root));
    const offline = await upgradeCheck(runner, root, from);
    assert.deepEqual(
      offline.problems,
      [],
      `${from} to the working tree must be a supported upgrade`,
    );
    const parent = await mkdtemp(join(tmpdir(), "kore-upgrade-"));
    const tree = join(parent, from);
    const marker = randomUUID();
    let treeReady = false;
    try {
      await clusterDestroy(repository, runner, { yes: true, purgeData: true });
      await checkoutRelease(runner, root, from, tree);
      treeReady = true;
      const installed = await releaseKore(runner, tree, [
        "local",
        "up",
        "--environment",
        "local",
      ]);
      assert.equal(installed.code, 0, `${from} kore local up must converge`);
      await assertReferenceSmoke(repository, runner);
      const before = await contractSchema(repository, runner);
      await psql(
        repository,
        runner,
        `CREATE TABLE ${TABLE} (marker text NOT NULL)`,
      );
      await psql(
        repository,
        runner,
        `INSERT INTO ${TABLE} VALUES ('${marker}')`,
      );

      const upgraded = await runner.run(
        "node",
        ["dist/src/cli/cli.js", "local", "up", "--environment", "local"],
        { capture: false, cwd: join(root, "tools/kore"), env: process.env },
      );
      assert.equal(
        upgraded.code,
        0,
        "the working-tree kore local up must converge",
      );

      await assertUpgraded(repository, runner, marker, before);
    } finally {
      try {
        if (treeReady) {
          await psql(repository, runner, `DROP TABLE IF EXISTS ${TABLE}`).catch(
            () => undefined,
          );
        }
        await stopLocalTunnel(repository, runner);
      } finally {
        await removeRelease(runner, root, tree);
        await rm(parent, { recursive: true, force: true });
      }
    }
  },
);
