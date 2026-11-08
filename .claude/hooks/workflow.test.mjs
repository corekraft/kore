import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflows = join(root, ".github", "workflows");
const check = () => readFileSync(join(workflows, "check.yml"), "utf8");

test("every third-party action is pinned by full commit SHA with a release tag comment", () => {
  const files = readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0);
  for (const file of files) {
    const uses = readFileSync(join(workflows, file), "utf8")
      .split("\n")
      .filter((line) => /^\s*-?\s*uses:/.test(line));
    for (const line of uses) {
      assert.match(
        line,
        /uses: [^@\s]+@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*$/,
        `${file}: ${line.trim()}`,
      );
    }
  }
});

test("the workflow runs on pull requests and pushes to main only", () => {
  const text = check();
  assert.match(
    text,
    /^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n/m,
  );
});

test("the workflow is read-only and uses no secrets", () => {
  const text = check();
  assert.match(text, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(text, /secrets\./);
});

test("the workflow runs every check the commit and stop hooks run, in order", () => {
  const runs = [...check().matchAll(/^\s+run: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(runs, [
    "npm ci --prefix tools/kore",
    "npm --prefix tools/kore run check",
    "mise run test",
    "mise run test-hooks",
    "mise run test-opa",
    "mise run test-gatekeeper",
    "mise run test-promtool",
    "mise run validate",
    "mise run kb-check -- --strict",
    "mise run scan",
  ]);
});

test("mise installs only the tools the checks need", () => {
  const text = check();
  assert.match(text, /install_args: node npm opa gator helm promtool$/m);
  assert.match(
    text,
    /install_args: trufflehog osv-scanner semgrep actionlint zizmor hadolint$/m,
  );
});

test("the workflow never calls a model", () => {
  assert.doesNotMatch(check(), /\bclaude\b|eval-harness|ANTHROPIC/i);
});

test("mise tasks cannot install tools beyond the ones each job installed", () => {
  const jobs = check()
    .split(/^ {2}(?=\w+:\n {4}runs-on)/m)
    .slice(1);
  assert.equal(jobs.length, 2);
  for (const job of jobs) {
    assert.match(
      job,
      /^ {4}env:\n(?: {6}.+\n)*? {6}MISE_TASK_RUN_AUTO_INSTALL: "false"\n/m,
    );
  }
});

test("checkout fetches full history, so kb-check's stale-document dates are real", () => {
  assert.match(check(), /^\s+fetch-depth: 0\s*$/m);
});

const release = () => readFileSync(join(workflows, "release.yaml"), "utf8");
const subject =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/";

test("the release workflow triggers only on version tags", () => {
  const text = release();
  assert.match(
    text,
    /^on:\n {2}push:\n {4}tags: \["v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"\]\n\n/m,
  );
  assert.doesNotMatch(text, /pull_request|workflow_dispatch|branches:/);
});

test("the release workflow grants write scopes to its job only, never the workflow", () => {
  const text = release();
  assert.match(text, /^permissions:\n {2}contents: read\n/m);
  const job = text.slice(text.indexOf("jobs:"));
  assert.match(job, /^ {6}id-token: write$/m);
  assert.match(job, /^ {6}packages: write$/m);
  assert.doesNotMatch(text.slice(0, text.indexOf("jobs:")), /: write/);
});

test("the release workflow signs and verifies by digest with an exact identity", () => {
  const text = release();
  assert.match(text, /cosign sign --yes "\$\{?IMAGE\}?@\$\{?DIGEST\}?"/);
  assert.doesNotMatch(text, /cosign sign[^\n]*:\$\{?\w*TAG/);
  assert.match(
    text,
    /cosign verify \\\n\s+--certificate-identity "\$IDENTITY"/,
  );
  assert.match(text, /--certificate-oidc-issuer "\$ISSUER"/);
  assert.match(
    text,
    /^ {6}ISSUER: https:\/\/token\.actions\.githubusercontent\.com$/m,
  );
  assert.doesNotMatch(text, /-regexp/);
  assert.doesNotMatch(text, /--insecure-ignore-tlog|--key\b/);
  assert.ok(
    text.includes(`IDENTITY: ${subject}\${{ github.ref_name }}`),
    "identity is this workflow on the pushed tag",
  );
});

test("the release workflow names the registry once and emits an image lock", () => {
  const text = release();
  assert.equal(text.match(/ghcr\.io\/corekraft\/kore\/reference/g)?.length, 1);
  assert.match(text, /apps\/reference/);
  assert.match(text, /version: 1|"version":\s*1|version:1/);
  assert.match(text, /authorizedSigners/);
  assert.match(text, /upload-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  assert.doesNotMatch(text, /secrets\.(?!GITHUB_TOKEN)/);
});

test("the release workflow checks out without credentials and installs only cosign", () => {
  const text = release();
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /install_args: cosign$/m);
  assert.match(text, /cache: false/);
});
