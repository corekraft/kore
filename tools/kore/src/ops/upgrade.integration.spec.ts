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
import {
  THROWAWAY,
  installThrowawayEnvironment,
} from "./throwaway-environment.js";
import { previousRelease, upgradeCheck } from "./upgrade.js";

// Docs: docs/operations/support-and-upgrades.md
// Live: proves the supported upgrade path (Step 15) in a SEPARATE throwaway
// Minikube profile (kore-upgrade-test, environment upgrade-test, Gateway port
// 18443), so it never touches kore-local, its tunnel (8443), or its retained
// data. It installs the platform and reference app with the previous release
// tag's own built CLI and catalog (a detached git worktree outside the
// repository), writes a marker row into the retained reference database, then
// upgrades with this working tree's `kore local up` and checks that every
// component is ready, the reference app still serves, the marker survived, and
// the application contract (the PostgreSQLInstance XRD schema) did not change.
// The finally block deletes only the throwaway profile and removes the
// generated environment directories and the worktree. Secrets need the SOPS age
// identity: set SOPS_AGE_KEY_FILE to its path (the key file is never copied or
// read by the test). Set KORE_UPGRADE_FROM=<tag> to override the newest v* tag.
// Both profiles need CPU and memory at once (about 8 GiB more than kore-local).
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

const skipReason = (): string | false => {
  if (process.env["KORE_RUN_INTEGRATION"] !== "1") {
    return "set KORE_RUN_INTEGRATION=1 to opt into a live platform";
  }
  return process.env["SOPS_AGE_KEY_FILE"]
    ? false
    : "set SOPS_AGE_KEY_FILE to the path of your SOPS age identity (Kore passes the variable to sops and never reads the key)";
};

const environmentArgs = ["--environment", THROWAWAY.name];

/** Installs the previous release into the throwaway profile and seeds a marker. */
async function installPrevious(
  runner: ProcessRunner,
  repository: Repository,
  tree: string,
  from: string,
  marker: string,
): Promise<Record<string, unknown>> {
  const installed = await releaseKore(runner, tree, [
    "local",
    "up",
    ...environmentArgs,
  ]);
  assert.equal(installed.code, 0, `${from} kore local up must converge`);
  await assertReferenceSmoke(repository, runner);
  const before = await contractSchema(repository, runner);
  const create = `CREATE TABLE ${TABLE} (marker text NOT NULL)`;
  await psql(repository, runner, create);
  await psql(repository, runner, `INSERT INTO ${TABLE} VALUES ('${marker}')`);
  return before;
}

test(
  "a supported upgrade from the previous release keeps the reference app, its data, and the application contract",
  { concurrency: false, skip: skipReason(), timeout: 90 * 60 * 1000 },
  async () => {
    const root = await findRoot();
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
    const removers: (() => Promise<void>)[] = [];
    let repository: Repository | undefined;
    try {
      removers.push(await installThrowawayEnvironment(root));
      repository = await loadRepository(THROWAWAY.name, root);
      assert.equal(repository.environment.cluster.profile, THROWAWAY.profile);
      assert.notEqual(repository.environment.kubeContext, "kore-local");
      await checkoutRelease(runner, root, from, tree);
      removers.push(await installThrowawayEnvironment(tree));
      const marker = randomUUID();
      const before = await installPrevious(
        runner,
        repository,
        tree,
        from,
        marker,
      );
      const upgraded = await runner.run(
        "node",
        ["dist/src/cli/cli.js", "local", "up", ...environmentArgs],
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
        if (repository) {
          await stopLocalTunnel(repository, runner);
          // Only the throwaway profile: a mismatch would be a bug, never a destroy.
          assert.equal(
            repository.environment.cluster.profile,
            THROWAWAY.profile,
          );
          await clusterDestroy(repository, runner, {
            yes: true,
            purgeData: true,
          });
        }
      } finally {
        await removeRelease(runner, root, tree);
        await Promise.all(removers.map((remove) => remove()));
        await rm(parent, { recursive: true, force: true });
      }
    }
  },
);
