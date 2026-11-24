import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

const CHARTS = [
  "opa-authorizer",
  "kore-postgresql-api",
  "kore-policy-templates",
  "kore-policy-constraints",
  "kore-policy-sync",
  "kore-hostname-ownership-templates",
  "kore-hostname-ownership",
  "kore-workload-defaults-templates",
  "kore-workload-defaults",
  "kore-local-tls",
  "kore-platform-config",
];

async function workflow(): Promise<string> {
  return readFile(
    join(await findRoot(), ".github/workflows/release.yaml"),
    "utf8",
  );
}

function job(text: string, name: string): string {
  const start = text.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name} exists`);
  const rest = text.slice(start + 1);
  const next = /\n  (?:[a-z-]+:\n|# )/.exec(rest.slice(1));
  return next ? rest.slice(0, next.index + 1) : rest;
}

async function script(): Promise<string> {
  return readFile(
    join(await findRoot(), ".github/scripts/package-platform-charts.sh"),
    "utf8",
  );
}

test("the charts job is tag-only and holds only the signing scopes", async () => {
  const charts = job(await workflow(), "charts");
  assert.match(charts, /if: github\.ref_type == 'tag'/);
  assert.match(charts, /install_args: cosign crane helm$/m);
  assert.match(charts, /persist-credentials: false/);
  assert.match(charts, /cache: false/);
  assert.match(
    charts,
    /permissions:\n\s+contents: read\n\s+packages: write\n\s+id-token: write\n/,
  );
  assert.doesNotMatch(charts, /contents: write/);
  assert.match(
    charts,
    /ISSUER: https:\/\/token\.actions\.githubusercontent\.com/,
  );
  assert.match(
    charts,
    /IDENTITY: https:\/\/github\.com\/corekraft\/kore\/\.github\/workflows\/release\.yaml@refs\/tags\/\$\{\{ github\.ref_name \}\}/,
  );
});

test("the charts job packages, pushes by digest, signs and verifies every chart", async () => {
  const charts = job(await workflow(), "charts");
  assert.match(charts, /\.github\/scripts\/package-platform-charts\.sh/);
  assert.match(charts, /CHARTS: ghcr\.io\/corekraft\/kore\/charts/);
  assert.match(charts, /link-mirror-package\.sh "\$CHARTS\//);
  assert.match(charts, /helm push/);
  assert.match(charts, /cosign sign --yes "\$CHARTS\/\$name@\$digest"/);
  assert.match(charts, /cosign verify/);
  assert.match(charts, /--certificate-identity "\$IDENTITY"/);
  assert.match(charts, /already published with a different digest/);
});

test("the chart lock names every chart by version and digest and is verified before upload", async () => {
  const charts = job(await workflow(), "charts");
  const write = charts.indexOf("- name: Write the platform chart lock");
  const verify = charts.indexOf("- name: Verify every chart lock entry");
  const upload = charts.indexOf("name: platform-charts.lock.json");
  assert.ok(write >= 0 && verify > write && upload > verify);
  assert.match(charts.slice(write, verify), /authorizedSigners: \[\$signer\]/);
  assert.match(
    charts.slice(verify, upload),
    /jq -r '\.entries\[\] \| "\\\(\.chart\)@\\\(\.digest\)"'/,
  );
  assert.match(charts.slice(verify, upload), /cosign verify/);
});

test("a separate write-assets job attaches the chart lock and never replaces a different one", async () => {
  const attach = job(await workflow(), "attach-chart-lock");
  assert.match(attach, /needs: charts/);
  assert.match(attach, /if: github\.ref_type == 'tag'/);
  assert.match(attach, /permissions:\n\s+contents: write\n\s+env:/);
  assert.doesNotMatch(attach, /id-token|packages:/);
  assert.match(attach, /gh release upload "\$TAG" platform-charts\.lock\.json/);
  assert.match(attach, /cmp published\/platform-charts\.lock\.json/);
  assert.match(attach, /refusing to replace it/);
});

test("the charts-main job runs only on main, with no needs, and signs with the main identity", async () => {
  const main = job(await workflow(), "charts-main");
  assert.match(main, /^    if: github\.ref == 'refs\/heads\/main'$/m);
  assert.doesNotMatch(main, /^    needs:/m);
  assert.doesNotMatch(main, /ref_type|refs\/tags|ref_name|TAG:/);
  assert.match(
    main,
    /^      IDENTITY: https:\/\/github\.com\/corekraft\/kore\/\.github\/workflows\/release\.yaml@refs\/heads\/main$/m,
  );
  assert.match(
    main,
    /ISSUER: https:\/\/token\.actions\.githubusercontent\.com/,
  );
  assert.match(
    main,
    /permissions:\n\s+contents: read\n\s+packages: write\n\s+id-token: write\n/,
  );
  assert.doesNotMatch(main, /contents: write/);
});

test("the charts-main job packages the same charts and pushes only a version that is absent", async () => {
  const main = job(await workflow(), "charts-main");
  assert.match(main, /\.github\/scripts\/package-platform-charts\.sh/);
  assert.match(main, /CHARTS: ghcr\.io\/corekraft\/kore\/charts/);
  assert.match(
    main,
    /if digest="\$\(mise exec -- crane digest "\$CHARTS\/\$name:\$version" 2> \/dev\/null\)"; then/,
  );
  assert.match(main, /helm push/);
  assert.match(main, /already published with a different digest/);
});

test("the charts-main job signs only a digest the main identity does not already verify", async () => {
  const main = job(await workflow(), "charts-main");
  assert.match(
    main,
    /if ! mise exec -- cosign verify[\s\S]*?cosign sign --yes "\$CHARTS\/\$name@\$digest"/,
  );
});

test("the charts-main job verifies every lock entry against the main identity before it uploads the lock", async () => {
  const main = job(await workflow(), "charts-main");
  const write = main.indexOf("- name: Write the platform chart lock");
  const verify = main.indexOf("- name: Verify every chart lock entry");
  const upload = main.indexOf(
    "name: platform-charts.lock.json-${{ github.sha }}",
  );
  assert.ok(
    write >= 0 && verify > write && upload > verify,
    "write, verify, then upload",
  );
  assert.match(main.slice(write, verify), /authorizedSigners: \[\$signer\]/);
  assert.match(
    main.slice(verify, upload),
    /cosign verify[\s\S]*--certificate-identity "\$IDENTITY"/,
  );
});

test("the charts-main job uploads the main lock as a 30-day artifact named by commit and never attaches it to a release", async () => {
  const main = job(await workflow(), "charts-main");
  assert.match(
    main,
    /name: platform-charts\.lock\.json-\$\{\{ github\.sha \}\}\n\s+path: platform-charts\.lock\.json\n\s+if-no-files-found: error\n\s+retention-days: 30\n/,
  );
  assert.doesNotMatch(main, /gh release|attach/);
});

test("the charts and charts-main jobs share one per-commit concurrency group that never cancels a running publish", async () => {
  const text = await workflow();
  for (const name of ["charts", "charts-main"]) {
    assert.match(
      job(text, name),
      /    concurrency:\n      group: charts-\$\{\{ github\.sha \}\}\n      cancel-in-progress: false\n/,
      name,
    );
  }
});

test("the tag charts job keeps its lock artifact for 30 days too", async () => {
  const charts = job(await workflow(), "charts");
  assert.match(charts, /if-no-files-found: error\n\s+retention-days: 30\n/);
});

test("the configuration charts are packaged and the image policy is not", async () => {
  const text = await script();
  for (const name of CHARTS) {
    assert.match(text, new RegExp(`\\b${name}\\b`));
  }
  assert.doesNotMatch(text, /kore-image-policy/);
  const root = await findRoot();
  const catalog = JSON.parse(
    readFileSync(join(root, "infra/catalog/components.yaml"), "utf8"),
  ) as { components: { name: string; phase: string }[] };
  for (const name of CHARTS) {
    const component = catalog.components.find((c) => c.name === name);
    assert.equal(component?.phase, "configuration", name);
  }
});

test("packaging is offline, content-addressed, and wraps plain manifests without re-templating them", async () => {
  const root = await findRoot();
  const out = mkdtempSync(join(tmpdir(), "kore-charts-"));
  const run = (): string[] =>
    execFileSync(
      join(root, ".github/scripts/package-platform-charts.sh"),
      [out],
      { cwd: root, encoding: "utf8" },
    )
      .trim()
      .split("\n");
  const first = run();
  const second = run();
  assert.deepEqual(second, first, "same content gives the same versions");
  const rows = first.map((line) => JSON.parse(line) as Record<string, string>);
  assert.deepEqual(
    rows.map((row) => row.name),
    CHARTS,
  );
  for (const row of rows) {
    assert.match(row.version ?? "", /^0\.0\.0-[0-9a-f]{12}$/, row.name ?? "");
    assert.match(row.file ?? "", new RegExp(`${row.name ?? ""}-0\\.0\\.0-`));
    // The release job pushes packaged/<file>, so the file must exist, and the
    // packaged chart must carry the catalog name that the OCI path is taken from.
    assert.ok(existsSync(join(out, row.file ?? "")), `${row.file} exists`);
  }
  for (const row of rows) {
    const chartName = execFileSync(
      "helm",
      ["show", "chart", join(out, row.file ?? "")],
      { encoding: "utf8" },
    ).match(/^name: (.+)$/m)?.[1];
    assert.equal(chartName, row.name, `${row.file} is named ${row.name}`);
  }
  // The Crossplane composition carries Go template text that Helm must not touch.
  const rendered = execFileSync(
    "helm",
    [
      "template",
      "x",
      join(out, "kore-postgresql-api-" + rows[1]?.version + ".tgz"),
    ],
    { encoding: "utf8" },
  );
  assert.match(
    rendered,
    /\{\{ \.observed\.composite\.resource\.spec\.storageSize \}\}/,
  );
}, 60_000);

test("the reference image lock and the template lock never mention the charts", async () => {
  const root = await findRoot();
  assert.doesNotMatch(
    await readFile(join(root, "infra/catalog/images.lock.json"), "utf8"),
    /\/charts\//,
  );
  const release = job(await workflow(), "release");
  assert.doesNotMatch(release, /platform-charts/);
});
