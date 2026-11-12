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
import { test } from "./node-test-shim.mjs";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(
  new URL("../../tools/kore/.husky/pre-commit", import.meta.url),
);

const helper = fileURLToPath(
  new URL("../../tools/kore/.husky/pinned.sh", import.meta.url),
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
function commit(files, failing = [], { withMise = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pre-commit-"));
  try {
    const opts = { cwd: root, env: cleanEnv, encoding: "utf8" };
    spawnSync("git", ["init", "-q"], opts);
    mkdirSync(join(root, "tools/kore/.husky"), { recursive: true });
    mkdirSync(join(root, "tools/harness"), { recursive: true });
    copyFileSync(hook, join(root, "hook.sh"));
    copyFileSync(helper, join(root, "tools/kore/.husky/pinned.sh"));
    const log = join(root, "calls.log");
    const bin = join(root, "bin");
    script(
      join(root, "tools/kore/node_modules/.bin/lint-staged"),
      `echo "lint-staged" >> "${log}"`,
    );
    script(join(bin, "node"), `echo "node $*" >> "${log}"`);
    if (withMise) {
      script(
        join(bin, "mise"),
        `echo "mise $*" >> "${log}"\n[ "$1" = exec ] && [ "$2" = -- ] || exit 2\nshift 2\nexec "$@"`,
      );
    }
    script(
      join(bin, "npm"),
      `echo "$*" >> "${log}"\necho "$(basename "$PWD") $*" >> "${log}.npm"\ncase " ${failing.join(" ")} " in *" $2 "*|*" $(basename "$PWD"):$2 "*) exit 1;; esac`,
    );
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "x\n");
    }
    spawnSync("git", ["add", "-A", "--", ...files], opts);
    const result = spawnSync("sh", [join(root, "hook.sh")], {
      ...opts,
      env: {
        ...cleanEnv,
        PATH: withMise ? `${bin}:${process.env.PATH}` : `${bin}:/usr/bin:/bin`,
      },
    });
    let calls = "";
    try {
      calls = readFileSync(log, "utf8");
    } catch {
      // npm never ran.
    }
    let npmCalls = "";
    try {
      npmCalls = readFileSync(`${log}.npm`, "utf8");
    } catch {
      // npm never ran.
    }
    return { status: result.status, stderr: result.stderr, calls, npmCalls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("every tool the hook runs goes through the pinned toolchain", () => {
  const result = commit([".claude/hooks/a.mjs", "tools/kore/src/a.ts"]);
  assert.equal(result.status, 0);
  const lines = result.calls.split("\n").filter(Boolean);
  const tools = lines.filter((l) => !l.startsWith("mise "));
  assert.deepEqual(
    tools.map((l) => l.split(" ")[0]),
    ["lint-staged", "run", "run", "run"],
  );
  assert.equal(lines.length, 8);
  for (const [i, l] of lines.entries()) {
    if (i % 2 === 0) assert.match(l, /^mise exec -- /);
  }
});

test("a missing mise blocks the commit with one actionable line and runs nothing", () => {
  const result = commit(["tools/kore/src/a.ts"], [], { withMise: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^git hook: mise is not installed; .+\n$/);
  assert.equal(result.calls, "");
});

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
    assert.doesNotMatch(result.calls, /npm|node /);
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

// Harness sources and the committed bundle have their own typecheck and tests,
// run from tools/harness; kore's checks stay out of it.
for (const file of [
  "tools/harness/src/a.ts",
  "tools/harness/tests/a.ts",
  "tools/harness/package.json",
  "skills/bin/harness.mjs",
]) {
  test(`staging ${file} runs the harness typecheck and unit tests, not kore's`, () => {
    const result = commit([file]);
    assert.equal(result.status, 0);
    assert.match(result.npmCalls, /^harness run check/m);
    assert.match(result.npmCalls, /^harness run test:unit/m);
    assert.doesNotMatch(result.npmCalls, /^kore /m);
  });
}

test("staging only unrelated files runs no harness checks", () => {
  const result = commit([
    "tools/kore/src/a.ts",
    "README.md",
    "skills/handoff/SKILL.md",
  ]);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.npmCalls, /^harness run (check|test:unit)/m);
});

test("a type-broken harness file blocks the commit with one actionable line and skips the harness tests", () => {
  const result = commit(["tools/harness/src/a.ts"], ["harness:check"]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /^pre-commit: harness typecheck failed; run .+tools\/harness.+\n$/,
  );
  assert.doesNotMatch(result.calls, /test:unit/);
});

test("failing harness unit tests block the commit with one actionable line", () => {
  const result = commit(["tools/harness/src/a.ts"], ["harness:test:unit"]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /^pre-commit: harness unit tests failed; run .+tools\/harness.+\n$/,
  );
});

test("staging a .claude file runs the hook tests under harness vitest, not node --test", () => {
  const result = commit([".claude/hooks/a.mjs"]);
  assert.equal(result.status, 0);
  assert.match(result.npmCalls, /^harness run test:hooks/m);
  assert.doesNotMatch(result.calls, /node /);
});

test("failing hook tests block the commit with one actionable line", () => {
  const result = commit([".claude/hooks/a.mjs"], ["harness:test:hooks"]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /^pre-commit: hook tests failed; run 'mise run test-hooks' and fix them\n$/,
  );
});
