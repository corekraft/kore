import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md
// Docs: docs/decisions/0172-the-platform-bumps-the-app-record-and-the-judge-merges-it-dark.md
// While app-delivery is on, the golden-path ApplicationSet gives each Application its
// release file as an optional values file, and the workload deploys the release's
// digest for each component that has one. With no release the lock images render as
// before. No cluster: helm template only.

const run = promisify(execFile);
const frontend = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
const bff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;
const releaseFrontend = `ghcr.io/corekraft/kore/static-frontend-template@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`;
const releaseBff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210`;
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
const fixtures = "tools/kore/integration/config/fixtures";
const frontendOnly = `${fixtures}/service-release-frontend-only.json`;
const frontendAndBff = `${fixtures}/service-release-frontend-and-bff.json`;

async function helm(
  chart: string,
  extra: string[],
  ...set: string[]
): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    chart,
    join(root, "infra/charts", chart),
    ...extra,
    ...set,
  ]);
  return stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
}

/** The workload render, with the release file at repository path `release` as its values file when given. */
async function workload(release?: string, ...set: string[]) {
  const root = await findRoot();
  return helm(
    "golden-path-workload",
    release === undefined ? [] : ["-f", join(root, release)],
    "--set",
    "service=auth",
    "--set",
    `frontend.image=${frontend}`,
    "--set",
    `bff.image=${bff}`,
    ...set,
  );
}

const delivery = (...set: string[]) =>
  helm(
    "golden-path-delivery",
    [],
    "--set",
    "repoURL=https://github.com/corekraft/kore.git",
    "--set",
    `revision=${revision}`,
    "--set",
    "environment=local",
    "--set-json",
    `templateImages=${lockEntries}`,
    ...set,
  );

const named = (docs: string[], kind: string, name: string) =>
  docs.find(
    (doc) =>
      new RegExp(`^kind: ${kind}$`, "m").test(doc) &&
      doc.includes(`\n  name: ${name}\n`),
  );

test("with no release the workload render is byte-identical to its default golden, so a service with no record keeps the lock images", async () => {
  const root = await findRoot();
  const docs = await workload();
  assert.equal(
    docs.join("\n---\n").trimEnd(),
    (
      await readFile(
        join(
          root,
          "tools/kore/integration/config/fixtures/golden-path-workload-default.golden.yaml",
        ),
        "utf8",
      )
    ).trimEnd(),
  );
});

async function goldenFixture(name: string): Promise<string> {
  const root = await findRoot();
  return (
    await readFile(join(root, `${fixtures}/${name}.golden.yaml`), "utf8")
  ).trimEnd();
}

test("a frontend-only release renders as its golden fixture, so a missing digest or lock image cannot recur unnoticed", async () => {
  const docs = await workload(frontendOnly);
  assert.equal(
    docs.join("\n---\n").trimEnd(),
    await goldenFixture("golden-path-workload-release-frontend-only"),
  );
});

test("a frontend-and-BFF release renders as its golden fixture, so each component's digest is checked", async () => {
  const docs = await workload(frontendAndBff);
  assert.equal(
    docs.join("\n---\n").trimEnd(),
    await goldenFixture("golden-path-workload-release-frontend-and-bff"),
  );
});

test("the ApplicationSet with app-delivery on renders as its golden fixture", async () => {
  const applicationSet = (await delivery("--set", "appDelivery=true"))[0]!;
  assert.equal(
    applicationSet.trimEnd(),
    await goldenFixture("golden-path-delivery-app-delivery"),
  );
});

test("a frontend-only release deploys its digest on the frontend and keeps the lock image on the BFF", async () => {
  const docs = await workload(frontendOnly);
  expect(named(docs, "Deployment", "auth-frontend")).toContain(
    `image: "${releaseFrontend}"`,
  );
  expect(named(docs, "Deployment", "auth-bff")).toContain(`image: "${bff}"`);
});

test("a frontend-and-BFF release deploys both digests, each on its own component", async () => {
  const docs = await workload(frontendAndBff);
  expect(named(docs, "Deployment", "auth-frontend")).toContain(
    `image: "${releaseFrontend}"`,
  );
  expect(named(docs, "Deployment", "auth-bff")).toContain(
    `image: "${releaseBff}"`,
  );
});

test("a release component with a digest and no attestation fails the render, so an unattested digest never deploys", async () => {
  const digestOnly = JSON.stringify({
    components: {
      frontend: { digest: `sha256:${"0123456789abcdef".repeat(4)}` },
    },
  });
  await expect(
    workload(undefined, "--set-json", `spec=${digestOnly}`),
  ).rejects.toThrow(/attestation/);
});

test("the ApplicationSet gives each Application its release as an optional values file only while app-delivery is on", async () => {
  const off = (await delivery())[0]!;
  assert.doesNotMatch(off, /valueFiles|ignoreMissingValueFiles/);
  const on = (await delivery("--set", "appDelivery=true"))[0]!;
  assert.match(
    on,
    /\n          ignoreMissingValueFiles: true\n          valueFiles:\n            - "\.\.\/\.\.\/\.\.\/infra\/environments\/local\/services\/\{\{ \.metadata\.name \}\}\.release\.json"\n/,
  );
});

test("the ApplicationSet keeps the lock images as its image parameters while app-delivery is on, so a service with no release still deploys the lock", async () => {
  const on = (await delivery("--set", "appDelivery=true"))[0]!;
  assert.ok(
    on.includes(
      `- name: frontend.image\n              value: "ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}"`,
    ),
  );
});
