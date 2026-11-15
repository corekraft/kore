import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  enabledComponents,
  findRoot,
  loadRepository,
  orderedComponents,
  platformArgocdDeliveryFlag,
  validateRepository,
} from "../../src/config/index.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md

const run = promisify(execFile);
const frontend = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
const bff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;
const revision = "c".repeat(40);
const signer =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v1.0.0";

const lockEntries = JSON.stringify({
  "static-frontend": {
    image: "ghcr.io/corekraft/kore/static-frontend-template",
    digest: `sha256:${"a".repeat(64)}`,
    signer,
  },
  "kotlin-bff": {
    image: "ghcr.io/corekraft/kore/kotlin-bff-template",
    digest: `sha256:${"b".repeat(64)}`,
    signer,
  },
});

async function helm(chart: string, ...set: string[]): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    chart,
    join(root, "infra/charts", chart),
    ...set,
  ]);
  return stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
}

const delivery = (...extra: string[]) =>
  helm(
    "golden-path-delivery",
    "--set",
    "repoURL=https://github.com/corekraft/kore.git",
    "--set",
    `revision=${revision}`,
    "--set",
    "environment=local",
    "--set-json",
    `templateImages=${lockEntries}`,
    ...extra,
  );

const workload = (...extra: string[]) =>
  helm(
    "golden-path-workload",
    "--set",
    "service=auth",
    "--set",
    `frontend.image=${frontend}`,
    "--set",
    `bff.image=${bff}`,
    ...extra,
  );

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return String((error as { stderr?: string }).stderr);
  }
  return assert.fail("expected the render to fail");
}

test("one ApplicationSet generates an Application per Service registration found in git", async () => {
  const docs = await delivery();
  assert.equal(docs.length, 1);
  const set = docs[0]!;
  assert.match(set, /^kind: ApplicationSet$/m);
  assert.match(set, /namespace: argocd/);
  assert.match(set, /goTemplate: true/);
  assert.match(set, /repoURL: "https:\/\/github.com\/corekraft\/kore.git"/);
  assert.match(set, new RegExp(`revision: "${revision}"`));
  assert.match(set, /path: "infra\/services\/\*\.yaml"/);
});

test("the generated Application deploys both template images by the lock's digest and never by tag", async () => {
  const set = (await delivery())[0]!;
  assert.ok(set.includes(`value: "${frontend}"`));
  assert.ok(set.includes(`value: "${bff}"`));
  assert.doesNotMatch(set, /:latest/);
});

test("the sync owns the workload: the Application never creates the namespace and prunes what it deploys", async () => {
  const set = (await delivery())[0]!;
  assert.match(set, /namespace: '\{\{ \.metadata\.name \}\}--local'/);
  assert.match(set, /prune: true/);
  assert.match(set, /selfHeal: true/);
  assert.doesNotMatch(set, /CreateNamespace=true/);
});

test("a template image without a sha256 digest is refused so a tag never reaches the cluster", async () => {
  const tagged = JSON.stringify({
    "static-frontend": { image: "ghcr.io/x/a", digest: "latest" },
    "kotlin-bff": { image: "ghcr.io/x/b", digest: `sha256:${"b".repeat(64)}` },
  });
  const message = await failure(
    delivery("--set-json", `templateImages=${tagged}`),
  );
  assert.match(message, /digest/);
});

test("a missing template lock entry fails the render rather than rendering a partial deploy", async () => {
  const partial = JSON.stringify({
    "static-frontend": {
      image: "ghcr.io/x/a",
      digest: `sha256:${"a".repeat(64)}`,
    },
  });
  const message = await failure(
    delivery("--set-json", `templateImages=${partial}`),
  );
  assert.match(message, /kotlin-bff/);
});

test("a branch name is refused as the revision so the sync follows a reviewed commit", async () => {
  const message = await failure(delivery("--set", "revision=main"));
  assert.match(message, /revision/);
});

test("the workload chart deploys the frontend and the BFF by digest, each with its Service", async () => {
  const docs = await workload();
  const kinds = docs.map((d) => /^kind: (\w+)$/m.exec(d)![1]).sort();
  assert.deepEqual(kinds, ["Deployment", "Deployment", "Service", "Service"]);
  const joined = docs.join("\n");
  assert.ok(joined.includes(`image: "${frontend}"`));
  assert.ok(joined.includes(`image: "${bff}"`));
  assert.match(joined, /allowPrivilegeEscalation: false/);
  assert.match(joined, /runAsNonRoot: true/);
});

test("the workload chart refuses an image reference that carries no digest", async () => {
  const message = await failure(
    workload("--set", "frontend.image=ghcr.io/x/a:1.0.0"),
  );
  assert.match(message, /frontend\/image.*sha256/);
});

test("the delivery chart is a gated catalog release installed after Argo CD and the Service API, and the workload chart is never a catalog release", async () => {
  const name = "kore-golden-path-delivery";
  for (const environment of ["local", "managed-example"]) {
    const repository = await loadRepository(environment);
    await validateRepository(repository);
    assert.equal(
      enabledComponents(repository).some((c) => c.name === name),
      false,
      `${environment} installs nothing with the flag off`,
    );
    assert.equal(
      repository.catalog.components.some((c) =>
        /golden-path-workload/.test(c.chart ?? ""),
      ),
      false,
      "kore never applies the workload; the sync owns it",
    );
  }
  const repository = await loadRepository("local");
  const on = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [platformArgocdDeliveryFlag]: true,
        "platform-organization-service-apis": true,
      },
    },
  };
  assert.equal(
    enabledComponents(on).some((c) => c.name === name),
    true,
  );
  const order = orderedComponents(on.catalog).map((c) => c.name);
  assert.ok(order.includes(name));
  assert.ok(order.indexOf("argocd") < order.indexOf(name));
  assert.ok(order.indexOf("kore-platform-apis") < order.indexOf(name));
});
