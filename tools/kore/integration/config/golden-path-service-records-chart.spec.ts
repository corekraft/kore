import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md

// The records Application and the ApplicationSet's CreateNamespace, rendered
// with serviceRecords off and on (ADR 0166). No cluster: helm template only.

const run = promisify(execFile);
const revision = "c".repeat(40);
const lockEntries = JSON.stringify({
  "static-frontend": {
    image: "ghcr.io/corekraft/kore/static-frontend-template",
    digest: `sha256:${"a".repeat(64)}`,
  },
  "kotlin-bff": {
    image: "ghcr.io/corekraft/kore/kotlin-bff-template",
    digest: `sha256:${"b".repeat(64)}`,
  },
});

async function delivery(...extra: string[]): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "golden-path-delivery",
    join(root, "infra/charts/golden-path-delivery"),
    "--set",
    "repoURL=https://github.com/corekraft/kore.git",
    "--set",
    `revision=${revision}`,
    "--set",
    "environment=local",
    "--set-json",
    `templateImages=${lockEntries}`,
    ...extra,
  ]);
  return stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
}

const applications = (docs: string[]) =>
  docs.filter((doc) => /^kind: Application$/m.test(doc));

const applicationSet = (docs: string[]) =>
  docs.find((doc) => /^kind: ApplicationSet$/m.test(doc))!;

test("with serviceRecords off the render adds no records Application, and the ApplicationSet keeps CreateNamespace so the sync creates the app namespace", async () => {
  const docs = await delivery();
  assert.equal(applications(docs).length, 0);
  assert.match(applicationSet(docs), /- CreateNamespace=true/);
});

test("with serviceRecords on the render adds one Application that syncs the Service records from git at the reviewed commit, without prune", async () => {
  const apps = applications(await delivery("--set", "serviceRecords=true"));
  assert.equal(apps.length, 1);
  const app = apps[0]!;
  assert.match(
    app,
    /^metadata:\n  name: service-records\n  namespace: argocd$/m,
  );
  assert.match(app, /project: "default"/);
  assert.match(app, /repoURL: "https:\/\/github.com\/corekraft\/kore.git"/);
  assert.match(app, new RegExp(`targetRevision: "${revision}"`));
  assert.match(app, /path: "infra\/services"/);
  assert.match(app, /include: "\*\.yaml"/);
  assert.match(app, /server: https:\/\/kubernetes\.default\.svc/);
  assert.match(app, /prune: false/);
  assert.match(app, /selfHeal: true/);
});

test("with serviceRecords on the ApplicationSet sets no CreateNamespace, because the Service composition is the one owner of the app namespace", async () => {
  const set = applicationSet(await delivery("--set", "serviceRecords=true"));
  assert.ok(set, "the ApplicationSet is still rendered");
  assert.doesNotMatch(set, /CreateNamespace=/);
  assert.doesNotMatch(set, /syncOptions/);
  assert.match(set, /prune: true/);
});
