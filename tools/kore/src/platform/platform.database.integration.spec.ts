import assert from "node:assert/strict";
import type { loadRepository } from "../config/index.js";
import type { ProcessRunner } from "../runtime/index.js";

type Repository = Awaited<ReturnType<typeof loadRepository>>;
type Psql = (pod: string, sql: string) => Promise<{ stdout: string }>;

const PRIMARY_SELECTOR =
  "--selector=cnpg.io/cluster=reference-db,cnpg.io/instanceRole=primary";
// `range` prints nothing for an empty list; an indexed path makes kubectl fail.
const PRIMARY_OUTPUT =
  "--output=jsonpath={range .items[*]}{.metadata.name}{'\\n'}{.metadata.uid}{'\\n'}{end}";

function kubectlBase(repository: Repository): string[] {
  return [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    "reference",
  ];
}

async function primaryPod(
  repository: Repository,
  runner: ProcessRunner,
): Promise<[string, string]> {
  const primary = await runner.run(
    "kubectl",
    [
      ...kubectlBase(repository),
      "get",
      "pods",
      PRIMARY_SELECTOR,
      PRIMARY_OUTPUT,
    ],
    { capture: true, cwd: repository.root },
  );
  const [pod = "", uid = ""] = primary.stdout.trim().split(/\r?\n/);
  return [pod, uid];
}

async function databasePassword(
  repository: Repository,
  runner: ProcessRunner,
): Promise<string> {
  const credential = await runner.run(
    "kubectl",
    [
      ...kubectlBase(repository),
      "get",
      "secret",
      "reference-db-app",
      "--output=jsonpath={.data.password}",
    ],
    { capture: true, cwd: repository.root },
  );
  return Buffer.from(credential.stdout.trim(), "base64").toString("utf8");
}

function psqlRunner(
  repository: Repository,
  runner: ProcessRunner,
  password: string,
): Psql {
  return async (pod, sql) =>
    runner.run(
      "kubectl",
      [
        ...kubectlBase(repository),
        "exec",
        pod,
        "--",
        "env",
        `PGPASSWORD=${password}`,
        "psql",
        "--host=127.0.0.1",
        "--username=app",
        "--dbname=app",
        "--tuples-only",
        "--no-align",
        `--command=${sql}`,
      ],
      { capture: true, cwd: repository.root },
    );
}

async function replacePrimary(
  repository: Repository,
  runner: ProcessRunner,
  pod: string,
  uid: string,
): Promise<string> {
  await runner.run(
    "kubectl",
    [...kubectlBase(repository), "delete", "pod", pod],
    { capture: true, cwd: repository.root },
  );
  for (let attempt = 0; attempt < 60; attempt++) {
    const [candidate, candidateUid] = await primaryPod(repository, runner);
    if (candidate && candidateUid && candidateUid !== uid) {
      return candidate;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return "";
}

async function writeMarker(psql: Psql, pod: string): Promise<void> {
  await psql(
    pod,
    "CREATE TABLE IF NOT EXISTS kore_smoke_persistence (id integer PRIMARY KEY, marker text NOT NULL)",
  );
  await psql(
    pod,
    "INSERT INTO kore_smoke_persistence (id, marker) VALUES (1, 'survives-pod-restart') ON CONFLICT (id) DO UPDATE SET marker = EXCLUDED.marker",
  );
}

export async function assertDatabasePersistence(
  repository: Repository,
  runner: ProcessRunner,
): Promise<void> {
  const [pod, uid] = await primaryPod(repository, runner);
  assert.notEqual(pod, "", "the reference database must have a primary pod");
  assert.notEqual(
    uid,
    "",
    "the reference database primary must have a Pod UID",
  );
  const password = await databasePassword(repository, runner);
  assert.notEqual(
    password,
    "",
    "the database connection Secret must contain a password",
  );
  const psql = psqlRunner(repository, runner, password);
  await writeMarker(psql, pod);

  const replacementPod = await replacePrimary(repository, runner, pod, uid);
  assert.notEqual(
    replacementPod,
    "",
    "the database must be recreated with a new Pod UID within five minutes",
  );
  await runner.run(
    "kubectl",
    [
      ...kubectlBase(repository),
      "wait",
      "--for=condition=Ready",
      `pod/${replacementPod}`,
      "--timeout=5m",
    ],
    { capture: true, cwd: repository.root },
  );
  const persisted = await psql(
    replacementPod,
    "SELECT marker FROM kore_smoke_persistence WHERE id = 1",
  );
  assert.equal(
    persisted.stdout.trim(),
    "survives-pod-restart",
    "database data must survive PostgreSQL pod replacement",
  );
}
