import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// Docs: docs/decisions/0024-reference-app-database-access.md
// Issue #1570. With migration.enabled the golden-path workload renders a PreSync hook: a Job
// that runs the migrate command from the BFF image the workload deploys, as the DDL credential
// (#1584), with its own ServiceAccount, a deadline and the hardened security context. Argo CD
// runs it before the rollout, so a failed migration fails the sync and the old pods keep serving.
// The workload never reads the migration credential. Off, nothing of it renders. No cluster:
// helm template only.

const run = promisify(execFile);
const frontend = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
const bff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;
const releaseBff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210`;
const frontendAndBffRelease =
  "tools/kore/integration/config/fixtures/service-release-frontend-and-bff.json";
const credential = "auth-db-ddl";
const command = ["node", "--experimental-strip-types", "src/migrate-main.ts"];

async function render(
  release: string | undefined,
  ...set: string[]
): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "golden-path-workload",
    join(root, "infra/charts/golden-path-workload"),
    ...(release === undefined ? [] : ["-f", join(root, release)]),
    ...set,
  ]);
  return stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
}

const service = ["--set", "service=auth"];
const both = [
  ...service,
  "--set",
  `frontend.image=${frontend}`,
  "--set",
  `bff.image=${bff}`,
];
const frontendOnly = [...service, "--set", `frontend.image=${frontend}`];
const migrationOn = [
  "--set",
  "migration.enabled=true",
  "--set-json",
  `migration.command=${JSON.stringify(command)}`,
  "--set",
  `migration.credentialSecret.name=${credential}`,
];

/** The stderr helm prints when it refuses the render; the command echo in the error message is not the refusal. */
async function refusal(...set: string[]): Promise<string> {
  try {
    await render(undefined, ...set);
  } catch (error) {
    if (
      error instanceof Error &&
      "stderr" in error &&
      typeof error.stderr === "string"
    ) {
      return error.stderr;
    }
    throw error;
  }
  throw new Error("the render was accepted, so it did not refuse");
}

const kindDocs = (docs: string[], kind: string) =>
  docs.filter((doc) => new RegExp(`^kind: ${kind}$`, "m").test(doc));

const job = (docs: string[]) => kindDocs(docs, "Job")[0] ?? "";

test("the workload with the migration on renders as its golden fixture, so the hook's annotations, deadline and credential are checked", async () => {
  const root = await findRoot();
  const docs = await render(undefined, ...both, ...migrationOn);
  const golden = await readFile(
    join(
      root,
      "tools/kore/integration/config/fixtures/golden-path-workload-migration.golden.yaml",
    ),
    "utf8",
  );
  expect(docs.join("\n---\n").trimEnd()).toBe(golden.trimEnd());
});

test("with the migration off the workload renders no Job and no migration ServiceAccount", async () => {
  const docs = await render(undefined, ...both);
  expect(kindDocs(docs, "Job")).toEqual([]);
  expect(docs.join("\n")).not.toContain("auth-migrate");
});

test("with the migration on the Job and its ServiceAccount are PreSync hooks that delete before creation and on success", async () => {
  const docs = await render(undefined, ...both, ...migrationOn);
  const hook = [
    "  annotations:\n",
    "    argocd.argoproj.io/hook: PreSync\n",
    "    argocd.argoproj.io/hook-delete-policy: BeforeHookCreation,HookSucceeded\n",
  ].join("");
  expect(job(docs)).toContain(hook);
  const serviceAccount = docs.find(
    (doc) =>
      doc.includes("\n  name: auth-migrate\n") &&
      /^kind: ServiceAccount$/m.test(doc),
  );
  expect(serviceAccount).toContain(hook);
});

test("the migration Job runs the migrate command from the BFF image, so a release digest reaches it", async () => {
  const docs = await render(frontendAndBffRelease, ...both, ...migrationOn);
  expect(job(docs)).toContain(`          image: "${releaseBff}"\n`);
  expect(job(docs)).toContain(
    `          command: ["node","--experimental-strip-types","src/migrate-main.ts"]\n`,
  );
});

test("the migration Job has a deadline, its own ServiceAccount and the hardened security context", async () => {
  const docs = await render(undefined, ...both, ...migrationOn);
  const found = job(docs);
  expect(found).toContain("  activeDeadlineSeconds: 600\n");
  expect(found).toContain("      serviceAccountName: auth-migrate\n");
  expect(found).toContain("      automountServiceAccountToken: false\n");
  expect(found).toContain("        runAsNonRoot: true\n");
  expect(found).toContain("          type: RuntimeDefault\n");
  expect(found).toContain("            allowPrivilegeEscalation: false\n");
  expect(found).toContain("            readOnlyRootFilesystem: true\n");
  expect(found).toContain("              drop: [ALL]\n");
  expect(found).toContain("      restartPolicy: Never\n");
});

test("the migration Job reads its connection and password from the DDL credential Secret", async () => {
  const docs = await render(undefined, ...both, ...migrationOn);
  const found = job(docs);
  expect(found).toContain(
    `            - {name: PGPASSWORD, valueFrom: {secretKeyRef: {name: ${credential}, key: password}}}\n`,
  );
  expect(found).toContain(
    `            - {name: PGUSER, valueFrom: {secretKeyRef: {name: ${credential}, key: username}}}\n`,
  );
});

test("no workload container reads the migration credential, so the running app cannot use DDL rights", async () => {
  const docs = await render(undefined, ...both, ...migrationOn);
  for (const deployment of kindDocs(docs, "Deployment")) {
    expect(deployment).not.toContain(credential);
  }
});

test("a migration with no BFF is refused, because the BFF carries the database", async () => {
  expect(await refusal(...frontendOnly, ...migrationOn)).toContain(
    "migration needs a bff",
  );
});

test("a migration with no migrate command is refused, so the Job never runs an empty command", async () => {
  expect(
    await refusal(
      ...both,
      "--set",
      "migration.enabled=true",
      "--set",
      `migration.credentialSecret.name=${credential}`,
    ),
  ).toContain("migration.command");
});

test("a migration with no DDL credential Secret name is refused, so the Job never reads an unnamed Secret", async () => {
  expect(
    await refusal(
      ...both,
      "--set",
      "migration.enabled=true",
      "--set-json",
      `migration.command=${JSON.stringify(command)}`,
    ),
  ).toContain("migration.credentialSecret.name");
});

test("the contract refuses a migration that does not take an advisory lock, so a rerun or a concurrent run cannot race", async () => {
  expect(
    await refusal(
      ...both,
      ...migrationOn,
      "--set",
      "migration.contract.advisoryLock=false",
    ),
  ).toContain("advisoryLock");
});

test("the contract refuses a migrations table other than schema_migrations", async () => {
  expect(
    await refusal(
      ...both,
      ...migrationOn,
      "--set",
      "migration.contract.migrationsTable=other",
    ),
  ).toContain("migrationsTable");
});
