// The pre-commit hook runs the typecheck and kore unit tests only when staged
// files can affect them, and blocks the commit with a one-line message on failure.
// Docs: AGENTS.md

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(
  new URL("../../tools/kore/.husky/pre-commit", import.meta.url),
);

const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

function script(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

// Stages `files` in a throwaway repo whose lint-staged and npm are fakes that
// log their calls; `failing` names the npm scripts that exit non-zero.
function commit(files, failing = []) {
  const root = mkdtempSync(join(tmpdir(), "pre-commit-"));
  try {
    const opts = { cwd: root, env: cleanEnv, encoding: "utf8" };
    spawnSync("git", ["init", "-q"], opts);
    copyFileSync(hook, join(root, "hook.sh"));
    script(join(root, "tools/kore/node_modules/.bin/lint-staged"), "exit 0");
    const log = join(root, "calls.log");
    const bin = join(root, "bin");
    script(
      join(bin, "npm"),
      `echo "$*" >> "${log}"\ncase " ${failing.join(" ")} " in *" $2 "*) exit 1;; esac`,
    );
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "x\n");
    }
    spawnSync("git", ["add", "-A", "--", ...files], opts);
    const result = spawnSync("sh", [join(root, "hook.sh")], {
      ...opts,
      env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}` },
    });
    let calls = "";
    try {
      calls = readFileSync(log, "utf8");
    } catch {
      // npm never ran.
    }
    return { status: result.status, stderr: result.stderr, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const file of [
  "tools/kore/src/a.ts",
  "tools/kore/package.json",
  "infra/catalog/x.json",
  "infra/charts/c/values.yaml",
  "infra/environments/local.json",
  "infra/policies/p.rego",
  "apps/reference/Dockerfile",
]) {
  test(`staging ${file} runs the typecheck and the unit tests`, () => {
    const result = commit([file]);
    assert.equal(result.status, 0);
    assert.match(result.calls, /run check/);
    assert.match(result.calls, /run test:unit/);
  });
}

for (const file of ["README.md", "docs/index.md", "infra/plans/1.md"]) {
  test(`staging only ${file} runs neither the typecheck nor the unit tests`, () => {
    const result = commit([file]);
    assert.equal(result.status, 0);
    assert.equal(result.calls, "");
  });
}

test("a failing typecheck blocks the commit with one actionable line and skips the tests", () => {
  const result = commit(["tools/kore/src/a.ts"], ["check"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^pre-commit: typecheck failed; run .+\n$/);
  assert.doesNotMatch(result.calls, /test:unit/);
});

test("failing unit tests block the commit with one actionable line", () => {
  const result = commit(["tools/kore/src/a.ts"], ["test:unit"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^pre-commit: unit tests failed; run .+\n$/);
});
