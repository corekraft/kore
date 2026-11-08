import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflows = join(root, ".github", "workflows");
const check = () => readFileSync(join(workflows, "check.yml"), "utf8");

test("every third-party action is pinned by full commit SHA with a release tag comment", () => {
  const files = readdirSync(workflows).filter((f) => f.endsWith(".yml"));
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
    "mise run validate",
    "mise run kb-check -- --strict",
  ]);
});

test("mise installs only the tools the checks need", () => {
  const text = check();
  assert.match(text, /install_args: node npm opa\b/);
});

test("the workflow never calls a model", () => {
  assert.doesNotMatch(check(), /\bclaude\b|eval-harness|ANTHROPIC/i);
});

test("mise tasks cannot install tools beyond the ones the job installed", () => {
  assert.match(
    check(),
    /^ {4}env:\n(?: {6}.+\n)*? {6}MISE_TASK_RUN_AUTO_INSTALL: "false"\n/m,
  );
});
