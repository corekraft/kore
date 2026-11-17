import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";

/** No GIT_* variable: under a git hook GIT_DIR names the real repository, which a fixture's git would read or rewrite (#368). */
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

const SCANNERS = {
  trufflehog: "3.99.7",
  "osv-scanner": "2.7.0",
  semgrep: "1.182.1",
  actionlint: "1.7.12",
  zizmor: "1.31.1",
  hadolint: "2.15.1",
};

const escape = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function read(path: string): Promise<string> {
  const { root } = await loadRepository("local");
  return readFile(join(root, path), "utf8");
}

function taskBlock(mise: string, name: string): string {
  const match = mise.match(
    new RegExp(`\\[tasks\\.${escape(name)}\\]\\n((?:(?!\\[).*\\n?)*)`),
  );
  assert.ok(match, `.mise.toml defines the ${name} task`);
  return match[1] ?? "";
}

test("every scanner is pinned exactly in mise and mirrored in the tool catalog", async () => {
  const mise = await read(".mise.toml");
  const { versions } = await loadRepository("local");
  for (const [tool, version] of Object.entries(SCANNERS)) {
    assert.match(
      mise,
      new RegExp(`^${escape(tool)} = "${escape(version)}"$`, "m"),
    );
    assert.equal(versions.tools[tool], version);
  }
});

test("scanners are never runtime dependencies of the CLI", async () => {
  const pkg = JSON.parse(await read("tools/kore/package.json")) as Record<
    string,
    Record<string, string> | undefined
  >;
  for (const field of ["dependencies", "devDependencies"]) {
    for (const tool of Object.keys(SCANNERS)) {
      assert.equal(pkg[field]?.[tool], undefined);
    }
  }
});

test("each scanner has its own task and the aggregate scan runs them all", async () => {
  const mise = await read(".mise.toml");
  const tasks = [
    "scan-secrets",
    "scan-vulns",
    "scan-sast",
    "scan-sast-test",
    "scan-sast-audit",
    "scan-workflows",
    "scan-dockerfiles",
  ];
  for (const name of tasks) {
    taskBlock(mise, name);
  }
  const scan = taskBlock(mise, "scan");
  for (const name of tasks) {
    assert.match(scan, new RegExp(`"${name}"`));
  }
});

test("the secret scan covers history and the working tree but never reads .kore", async () => {
  const mise = await read(".mise.toml");
  const block = taskBlock(mise, "scan-secrets");
  assert.match(block, /trufflehog git/);
  assert.match(block, /trufflehog filesystem/);
  assert.match(block, /--results=verified,unknown,unverified/);
  assert.match(block, /--exclude-paths/);
  assert.match(block, /--fail/);
  const excludes = await read(".trufflehog-exclude");
  for (const pattern of ["^\\.kore/", "(^|/)node_modules/", "(^|/)dist/"]) {
    assert.ok(
      excludes.split("\n").includes(pattern),
      `${pattern} is excluded from secret scans`,
    );
  }
  assert.match(excludes, /\.enc\\\.yaml/);
});

test("only the working-tree pass skips release-please's CHANGELOG.md, so the history pass still reads every committed version of it", async () => {
  const mise = await read(".mise.toml");
  const block = taskBlock(mise, "scan-secrets");
  const gitPass = block.match(/"(trufflehog git [^"]*)"/)?.[1] ?? "";
  const treePass = block.match(/"(git ls-files [^"]*)"/)?.[1] ?? "";
  assert.match(gitPass, /--exclude-paths=\.trufflehog-exclude\b(?!-)/);
  assert.match(treePass, /--exclude-paths=\.trufflehog-exclude-tree\b/);

  const patterns = (text: string): string[] =>
    text.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
  const history = patterns(await read(".trufflehog-exclude"));
  const tree = patterns(await read(".trufflehog-exclude-tree"));
  assert.ok(
    !history.some((pattern) => pattern.includes("CHANGELOG")),
    "the history pass never excludes CHANGELOG.md",
  );
  assert.deepEqual(
    tree.filter((pattern) => !history.includes(pattern)),
    ["^CHANGELOG\\.md$"],
    "the tree pass adds exactly the CHANGELOG.md path to the shared excludes",
  );
  assert.deepEqual(
    history.filter((pattern) => !tree.includes(pattern)),
    [],
    "the tree pass keeps every shared exclude",
  );
});

test("scanner tasks are offline-capable and send no telemetry", async () => {
  const mise = await read(".mise.toml");
  assert.match(taskBlock(mise, "scan-sast"), /--metrics=off/);
  assert.match(taskBlock(mise, "scan-sast"), /--disable-version-check/);
  assert.match(taskBlock(mise, "scan-sast"), /--error/);
  assert.doesNotMatch(
    taskBlock(mise, "scan-sast"),
    /--config[ =](auto|p\/|r\/)/,
  );
});

test("CI runs the scans through mise without publishing or signing", async () => {
  const workflow = await read(".github/workflows/check.yml");
  assert.match(workflow, /mise run scan\b/);
  assert.match(workflow, /\bscan:\n/);
  assert.doesNotMatch(workflow, /cosign sign|docker push|id-token: write/);
  for (const [, ref] of workflow.matchAll(/uses:\s*\S+@(\S+)/g)) {
    assert.match(ref ?? "", /^[0-9a-f]{40}$/, "actions are pinned by SHA");
  }
});

test("the workflow scan lists every committed workflow by hand", async () => {
  const block = taskBlock(await read(".mise.toml"), "scan-workflows");
  for (const file of ["check.yml", "release.yaml"]) {
    assert.match(
      block,
      new RegExp(`actionlint[^\\]]*\\.github/workflows/${file}`),
    );
  }
});

test("every tracked npm lockfile is scanned for vulnerabilities", async () => {
  const { root } = await loadRepository("local");
  const mise = await read(".mise.toml");
  const tracked = execFileSync(
    "git",
    ["ls-files", "--", "*package-lock.json"],
    {
      cwd: root,
      encoding: "utf8",
      env: gitEnv,
    },
  )
    .split("\n")
    .filter(Boolean);
  assert.ok(tracked.length > 0);
  for (const lockfile of tracked) {
    assert.ok(
      taskBlock(mise, "scan-vulns").includes(`-L ${lockfile}`),
      `${lockfile} is scanned by scan-vulns`,
    );
  }
});

test("the OSV scan ignores only GHSA-fc5q-39xc-vjpf, with a reason and an expiry date", async () => {
  const config = await read("osv-scanner.toml");
  const ids = [...config.matchAll(/^id = "([^"]+)"$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(ids, ["GHSA-fc5q-39xc-vjpf"]);
  assert.equal(config.match(/^\[\[IgnoredVulns\]\]$/gm)?.length, 1);
  assert.match(config, /^ignoreUntil = 2027-01-16$/m);
  assert.match(config, /^reason = "[^"]{20,}"$/m);
});

test("the OSV scan task reads the narrow ignore file, since the lockfiles sit in subdirectories", async () => {
  const block = taskBlock(await read(".mise.toml"), "scan-vulns");
  assert.match(block, /osv-scanner scan source --config osv-scanner\.toml /);
});

test("the SAST scan covers the harness source", async () => {
  const block = taskBlock(await read(".mise.toml"), "scan-sast");
  assert.match(block, /\btools\/harness\/src\b/);
});

test("the audit-mode SAST scan reports harness findings but never fails the build", async () => {
  const block = taskBlock(await read(".mise.toml"), "scan-sast-audit");
  assert.match(block, /kore-audit\.yaml/);
  assert.match(block, /\btools\/harness\/src\b/);
  assert.match(block, /--metrics=off/);
  assert.doesNotMatch(block, /--error/);
  assert.doesNotMatch(
    taskBlock(await read(".mise.toml"), "scan-sast"),
    /kore-audit/,
  );
});

test("the audit rule flags process.cwd outside the shared root resolver", async () => {
  const rules = await read("infra/policies/semgrep/kore-audit.yaml");
  assert.match(rules, /id: kore-harness-process-cwd/);
  assert.match(rules, /severity: INFO/);
  assert.match(rules, /process\.cwd\(\)/);
  assert.match(rules, /runtime\/main-root\.ts/);
  assert.match(rules, /runtime\/root\.ts/);
});
