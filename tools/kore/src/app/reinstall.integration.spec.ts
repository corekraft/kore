import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "../config/config.js";
import { loadRepository } from "../config/index.js";
import { assertReferenceSmoke } from "../platform/platform.reference-smoke.integration.spec.js";
import { ProcessRunner } from "../runtime/index.js";
import { appDown } from "./index.js";

// Docs: infra/plans/2-implementation.md#step-12-reference-application
// Live and opt-in (`npm run test:integration:reinstall`): on a running local
// profile with the `reference` application up, removes the workload with
// `kore app down` and reinstalls it with `kore local up`, and proves the
// retained database claim, its volume and a row written beforehand survive.
// The row goes into a marker table in the `postgres` maintenance database over
// the pod's local socket, so no Secret is read; the table is dropped at the end.

const namespace = "reference";
const claim = "reference-db";
const primary = "cnpg.io/cluster=reference-db,cnpg.io/instanceRole=primary";
const cli = fileURLToPath(new URL("../cli/cli.js", import.meta.url));

type Repository = Awaited<ReturnType<typeof loadRepository>>;

interface Session {
  repository: Repository;
  runner: ProcessRunner;
  kubectl: (...args: string[]) => Promise<string>;
  psql: (sql: string) => Promise<string>;
  claimUid: () => Promise<string>;
  volumeIdentity: () => Promise<string>;
  releaseDeployed: () => Promise<boolean>;
}

function newSession(repository: Repository): Session {
  const runner = new ProcessRunner();
  const context = repository.environment.kubeContext;
  const kubectl = async (...args: string[]): Promise<string> =>
    (
      await runner.run(
        "kubectl",
        ["--context", context, "--namespace", namespace, ...args],
        { capture: true },
      )
    ).stdout.trim();
  const psql = async (sql: string): Promise<string> =>
    await kubectl(
      "exec",
      await kubectl("get", "pod", `--selector=${primary}`, "--output=name"),
      "--container=postgres",
      "--",
      "psql",
      "--username=postgres",
      "--dbname=postgres",
      "--tuples-only",
      "--no-align",
      `--command=${sql}`,
    );
  const claimResource = `postgresqlinstances.platform.kore.dev/${claim}`;
  return {
    repository,
    runner,
    kubectl,
    psql,
    claimUid: () =>
      kubectl("get", claimResource, "--output=jsonpath={.metadata.uid}"),
    volumeIdentity: () =>
      kubectl(
        "get",
        "pvc",
        "--selector=cnpg.io/cluster=reference-db",
        '--output=jsonpath={range .items[*]}{.metadata.uid}/{.spec.volumeName}{"\\n"}{end}',
      ),
    releaseDeployed: () =>
      runner
        .run(
          "helm",
          [
            "status",
            namespace,
            `--namespace=${namespace}`,
            "--kube-context",
            context,
          ],
          { capture: true },
        )
        .then(
          () => true,
          () => false,
        ),
  };
}

const localUp = ({ runner }: Session) =>
  runner.run("node", [cli, "local", "up", "--environment", "local"], {
    capture: true,
  });

async function assertDataKept(
  session: Session,
  expected: { uid: string; identity: string; marker: string },
  when: string,
): Promise<void> {
  assert.equal(await session.claimUid(), expected.uid, `${when}: same claim`);
  assert.equal(
    await session.volumeIdentity(),
    expected.identity,
    `${when}: same volume`,
  );
  assert.match(
    await session.psql("SELECT value FROM kore_reinstall_marker"),
    new RegExp(expected.marker),
    `${when}: the row survives`,
  );
}

async function removeWorkload(session: Session): Promise<void> {
  const report = await appDown(session.repository, session.runner, namespace);
  assert.ok(
    report.retained.some((resource) => resource.includes(claim)),
    `app down reports the retained claim: ${JSON.stringify(report)}`,
  );
  assert.equal(await session.releaseDeployed(), false, "the release is gone");
  assert.equal(
    await session.kubectl(
      "get",
      "deployments",
      "--output=name",
      "--selector=app.kubernetes.io/part-of=reference",
    ),
    "",
    "no workload deployment remains",
  );
}

test(
  "removing and reinstalling the workload preserves retained application data",
  {
    concurrency: false,
    timeout: 45 * 60 * 1000,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
        : false,
  },
  async (t) => {
    const session = newSession(await loadRepository("local", await findRoot()));
    t.after(async () => {
      // Leave the profile as found: reinstall if a failure left the workload
      // down, and drop the marker table.
      if (!(await session.releaseDeployed())) {
        await localUp(session).catch(() => undefined);
      }
      await session
        .psql("DROP TABLE IF EXISTS kore_reinstall_marker")
        .catch(() => undefined);
    });

    assert.equal(
      await session.kubectl(
        "get",
        `postgresqlinstances.platform.kore.dev/${claim}`,
        '--output=jsonpath={.status.conditions[?(@.type=="Ready")].status}',
      ),
      "True",
      "the reference database must be ready before the test starts",
    );
    const marker = randomUUID();
    await session.psql(
      `CREATE TABLE IF NOT EXISTS kore_reinstall_marker (value text); INSERT INTO kore_reinstall_marker VALUES ('${marker}')`,
    );
    const expected = {
      uid: await session.claimUid(),
      identity: await session.volumeIdentity(),
      marker,
    };
    assert.ok(expected.identity.includes("/pvc-"), "a bound volume exists");

    await removeWorkload(session);
    await assertDataKept(session, expected, "after removal");

    await localUp(session);
    await session.kubectl(
      "rollout",
      "status",
      "deployment/reference-api",
      "--timeout=10m",
    );
    await assertDataKept(session, expected, "after reinstall");
    await assertReferenceSmoke(session.repository, session.runner);
  },
);
