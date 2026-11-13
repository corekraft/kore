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

const testLock = fileURLToPath(
  new URL("../../tools/kore/.husky/test-lock.mjs", import.meta.url),
);

const testSlots = fileURLToPath(
  new URL("../../tools/kore/.husky/test-slots.mjs", import.meta.url),
);

const testWorkers = fileURLToPath(
  new URL("../../tools/kore/.husky/test-workers.mjs", import.meta.url),
);

const related = fileURLToPath(
  new URL("../../tools/kore/.husky/related-tests.mjs", import.meta.url),
);

const sastStaged = fileURLToPath(
  new URL("../../tools/kore/.husky/sast-staged.mjs", import.meta.url),
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
// log their calls; `failing` names the npm scripts that exit non-zero. `seed`
// maps extra repository paths (specs) to contents; they exist but stay unstaged.
function commit(
  files,
  failing = [],
  { withMise = true, seed = {}, gitCrash = false, rerun } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "pre-commit-"));
  try {
    const opts = { cwd: root, env: cleanEnv, encoding: "utf8" };
    spawnSync("git", ["init", "-q"], opts);
    // The harness around the repo is not part of it; an untracked file would stop a pass being recorded.
    writeFileSync(
      join(root, ".git/info/exclude"),
      "hook.sh\nbin\ncalls.log*\n.kore\ntools/kore/node_modules\ntools/kore/.husky\n",
    );
    mkdirSync(join(root, "tools/kore/.husky"), { recursive: true });
    mkdirSync(join(root, "tools/harness"), { recursive: true });
    copyFileSync(hook, join(root, "hook.sh"));
    copyFileSync(helper, join(root, "tools/kore/.husky/pinned.sh"));
    copyFileSync(related, join(root, "tools/kore/.husky/related-tests.mjs"));
    copyFileSync(testLock, join(root, "tools/kore/.husky/test-lock.mjs"));
    copyFileSync(testSlots, join(root, "tools/kore/.husky/test-slots.mjs"));
    copyFileSync(testWorkers, join(root, "tools/kore/.husky/test-workers.mjs"));
    copyFileSync(sastStaged, join(root, "tools/kore/.husky/sast-staged.mjs"));
    for (const [path, content] of Object.entries(seed)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const log = join(root, "calls.log");
    const bin = join(root, "bin");
    script(
      join(root, "tools/kore/node_modules/.bin/lint-staged"),
      `echo "lint-staged" >> "${log}"`,
    );
    script(
      join(bin, "node"),
      `echo "node $*" >> "${log}"\ncase "$1" in *related-tests.mjs|*test-lock.mjs|*sast-staged.mjs) exec "${process.execPath}" "$@";; esac\ncase " ${failing.join(" ")} " in *" node "*) exit 1;; esac\ncase " $* " in *" hook workflow-permissions "*) case " ${failing.join(" ")} " in *" node:workflow-permissions "*) exit 1;; esac;; esac`,
    );
    if (withMise) {
      script(
        join(bin, "mise"),
        `echo "mise $*" >> "${log}"\n[ "$1" = exec ] && [ "$2" = -- ] || exit 2\nshift 2\nexec "$@"`,
      );
    }
    script(
      join(bin, "semgrep"),
      `echo "semgrep $*" >> "${log}"\ncase "$1" in --version) case " ${failing.join(" ")} " in *" semgrep:version "*) exit 1;; esac; exit 0;; esac\ncase " ${failing.join(" ")} " in *" semgrep "*) exit 1;; esac`,
    );
    script(
      join(bin, "npm"),
      `echo "$*" >> "${log}"\necho "$(basename "$PWD") $*" >> "${log}.npm"\ncase " ${failing.join(" ")} " in *" $2 "*|*" $(basename "$PWD"):$2 "*) exit 1;; esac`,
    );
    if (gitCrash) {
      // `git write-tree` (the tree the test lock keys a pass on) crashes; every other git call is real.
      const realGit = spawnSync("which", ["git"], {
        encoding: "utf8",
      }).stdout.trim();
      script(
        join(bin, "git"),
        `case "$1" in write-tree) echo "fatal: simulated crash" >&2; exit 128;; esac\nexec "${realGit}" "$@"`,
      );
    }
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "x\n");
    }
    spawnSync("git", ["add", "-A", "--", ...files], opts);
    const hookEnv = {
      ...cleanEnv,
      // A live run on this host (its lease) must not add an audit line to the hook's stderr.
      KORE_HOST_ROOT: root,
      PATH: withMise ? `${bin}:${process.env.PATH}` : `${bin}:/usr/bin:/bin`,
    };
    let result = spawnSync("sh", [join(root, "hook.sh")], {
      ...opts,
      env: hookEnv,
    });
    if (rerun !== undefined) {
      // A second commit attempt: forget the first one's calls, optionally stage more.
      rmSync(log, { force: true });
      rmSync(`${log}.npm`, { force: true });
      for (const file of rerun.stage ?? []) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), "y\n");
        spawnSync("git", ["add", "--", file], opts);
      }
      result = spawnSync("sh", [join(root, "hook.sh")], {
        ...opts,
        env: hookEnv,
      });
    }
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
    // Each test run goes through the host-wide test lock (a node call).
    [
      "lint-staged",
      "node",
      "run",
      "node",
      "node",
      // The SAST step selects the staged source, checks semgrep, then scans.
      "node",
      "semgrep",
      "semgrep",
      "run",
      "node",
      "node",
      "run",
    ],
  );
  assert.equal(lines.length, 22);
  // Every tool call follows a mise exec, except the test command the lock
  // starts, which inherits the pinned PATH from the call before it.
  for (const [i, l] of lines.entries()) {
    if (l.startsWith("mise ") || lines[i - 1]?.includes("test-lock.mjs"))
      continue;
    assert.match(lines[i - 1] ?? "", /^mise exec -- /);
  }
});

test("a missing mise blocks the commit with one actionable line and runs nothing", () => {
  const result = commit(["tools/kore/src/a.ts"], [], { withMise: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^git hook: mise is not installed; .+\n$/);
  assert.equal(result.calls, "");
});

// A one-file change runs only the specs that import it; the full suite stays in CI.
test("staging one kore source file runs only the tests related to it, with a small worker pool", () => {
  const result = commit(["tools/kore/src/a.ts"]);
  assert.equal(result.status, 0);
  assert.match(result.calls, /run check/);
  assert.match(
    result.npmCalls,
    /^kore run test:related --silent -- src\/a\.ts$/m,
  );
  assert.doesNotMatch(result.calls, /test:unit/);
});

// Config and shared test setup can change every spec, so they run the full suite.
for (const file of [
  "tools/kore/package.json",
  "tools/kore/package-lock.json",
  "tools/kore/tsconfig.json",
  "tools/kore/vitest.config.ts",
  "tools/kore/src/test-setup-support.ts",
]) {
  test(`staging ${file} runs the typecheck and the full kore unit suite`, () => {
    const result = commit([file]);
    assert.equal(result.status, 0);
    assert.match(result.calls, /run check/);
    assert.match(result.npmCalls, /^kore run test:unit/m);
    assert.doesNotMatch(result.calls, /test:related/);
  });
}

// The repository specs read infra/ and apps/ by path, so a staged file there
// runs the specs that name its directory, plus the specs that scan the tree.
test("staging an infra file runs the specs that name its directory and the tree-wide specs", () => {
  const result = commit(["infra/charts/c/values.yaml"], [], {
    seed: {
      "tools/kore/src/a/charts.spec.ts": 'join(root, "infra/charts/c")',
      "tools/kore/src/a/catalog.spec.ts": 'join(root, "infra/catalog")',
      "tools/kore/src/a/tree.spec.ts": 'join(root, "infra")',
      "tools/kore/src/a/live.integration.spec.ts": 'join(root, "infra/charts")',
    },
  });
  assert.equal(result.status, 0);
  assert.match(result.calls, /run check/);
  const line = result.npmCalls.match(/^kore run test:related .*$/m)?.[0] ?? "";
  assert.match(line, /src\/a\/charts\.spec\.ts/);
  assert.match(line, /src\/a\/tree\.spec\.ts/);
  assert.doesNotMatch(line, /catalog\.spec|integration/);
  assert.doesNotMatch(result.calls, /test:unit/);
});

test("staging an apps file runs the specs that name apps/", () => {
  const result = commit(["apps/reference/Dockerfile"], [], {
    seed: {
      "tools/kore/src/a/ref.spec.ts": 'join(root, "apps/reference")',
      "tools/kore/src/a/charts.spec.ts": 'join(root, "infra/charts")',
    },
  });
  assert.equal(result.status, 0);
  const line = result.npmCalls.match(/^kore run test:related .*$/m)?.[0] ?? "";
  assert.match(line, /src\/a\/ref\.spec\.ts/);
  assert.doesNotMatch(line, /charts\.spec/);
});

test("an infra file no spec reads still typechecks but runs no tests", () => {
  const result = commit(["infra/policies/p.rego"], [], {
    seed: { "tools/kore/src/a/charts.spec.ts": 'join(root, "infra/charts")' },
  });
  assert.equal(result.status, 0);
  assert.match(result.calls, /run check/);
  assert.doesNotMatch(result.calls, /test:(related|unit)/);
});

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

test("a failing related test blocks the commit with one actionable line", () => {
  const result = commit(["tools/kore/src/a.ts"], ["test:related"]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /^pre-commit: related unit tests failed; run 'npm run test:related -- .+' in tools\/kore.+\n$/,
  );
});

test("a failing full unit suite blocks the commit with one actionable line", () => {
  const result = commit(["tools/kore/package.json"], ["test:unit"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^pre-commit: unit tests failed; run .+\n$/);
});

// Harness sources run their typecheck and only the tests related to them, from
// tools/harness; kore's checks stay out of it.
for (const file of ["tools/harness/src/a.ts", "tools/harness/tests/a.ts"]) {
  test(`staging ${file} runs the harness typecheck and only its related tests, not kore's`, () => {
    const result = commit([file]);
    assert.equal(result.status, 0);
    assert.match(result.npmCalls, /^harness run check/m);
    assert.match(
      result.npmCalls,
      new RegExp(
        `^harness run test:related --silent -- ${file.slice(14)}$`,
        "m",
      ),
    );
    assert.doesNotMatch(result.npmCalls, /test:unit/);
    assert.doesNotMatch(result.npmCalls, /^kore /m);
  });
}

for (const file of [
  "tools/harness/package.json",
  "tools/harness/package-lock.json",
  "tools/harness/tsconfig.json",
  "tools/harness/vitest.config.ts",
]) {
  test(`staging ${file} runs the harness typecheck and the full harness unit suite`, () => {
    const result = commit([file]);
    assert.equal(result.status, 0);
    assert.match(result.npmCalls, /^harness run check/m);
    assert.match(result.npmCalls, /^harness run test:unit/m);
    assert.doesNotMatch(result.npmCalls, /test:related/);
  });
}

test("staging only unrelated files runs no harness checks", () => {
  const result = commit([
    "tools/kore/src/a.ts",
    "README.md",
    "skills/handoff/SKILL.md",
  ]);
  assert.equal(result.status, 0);
  assert.doesNotMatch(
    result.npmCalls,
    /^harness run (check|test:unit|test:related)/m,
  );
});

test("a type-broken harness file blocks the commit with one actionable line and skips the harness tests", () => {
  const result = commit(["tools/harness/src/a.ts"], ["harness:check"]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /^pre-commit: harness typecheck failed; run .+tools\/harness.+\n$/,
  );
  assert.doesNotMatch(result.calls, /test:(unit|related)/);
});

test("a failing related harness test blocks the commit with one actionable line", () => {
  const result = commit(["tools/harness/src/a.ts"], ["harness:test:related"]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /^pre-commit: harness related tests failed; run 'npm run test:related -- .+' in tools\/harness.+\n$/,
  );
});

test("failing full harness unit tests block the commit with one actionable line", () => {
  const result = commit(["tools/harness/package.json"], ["harness:test:unit"]);
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
  assert.doesNotMatch(result.calls, /node --test/);
});

test("staging a skill, .claude or .codex file checks the skill links strictly with the harness hook", () => {
  for (const file of ["skills/a/SKILL.md", ".claude/a.json", ".codex/a.toml"]) {
    const result = commit([file]);
    assert.equal(result.status, 0, file);
    assert.match(
      result.calls,
      /^node .*\/skills\/bin\/harness\.mjs hook skill-links --strict$/m,
      file,
    );
  }
});

test("a wrong skill link blocks the commit with one actionable line", () => {
  const result = commit(["skills/a/SKILL.md"], ["node"]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /^pre-commit: skill links are wrong; run 'node skills\/bin\/harness\.mjs hook skill-links --strict' and fix them\n$/,
  );
});

test("staging a workflow, skill, .claude or .codex file checks workflow permissions strictly with the harness hook", () => {
  for (const file of [
    ".github/workflows/a.yml",
    "skills/a/SKILL.md",
    ".claude/a.json",
    ".codex/a.toml",
  ]) {
    const result = commit([file]);
    assert.equal(result.status, 0, file);
    assert.match(
      result.calls,
      /^node .*\/skills\/bin\/harness\.mjs hook workflow-permissions --strict$/m,
      file,
    );
  }
});

test("a wrong workflow permission blocks the commit with one actionable line", () => {
  const result = commit(
    [".github/workflows/a.yml"],
    ["node:workflow-permissions"],
  );
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /^pre-commit: workflow permissions are wrong; run 'node skills\/bin\/harness\.mjs hook workflow-permissions --strict' and fix them\n$/,
  );
});

test("staging nothing under .github/workflows, skills, .claude or .codex does not check workflow permissions", () => {
  const result = commit(["tools/kore/src/a.ts"]);
  assert.doesNotMatch(result.calls, /workflow-permissions/);
});

test("staging nothing under skills, .claude or .codex does not check skill links", () => {
  const result = commit(["tools/kore/src/a.ts"]);
  assert.doesNotMatch(result.calls, /skill-links/);
});

test("failing hook tests block the commit with one actionable line", () => {
  const result = commit([".claude/hooks/a.mjs"], ["harness:test:hooks"]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /^pre-commit: hook tests failed; run 'mise run test-hooks' and fix them\n$/,
  );
});

// SAST: the committed Semgrep rules run on staged source only, so a
// kore-dynamic-regexp finding fails here instead of in CI.
test("staging a scanned source file runs the Semgrep rules on it through the pinned toolchain", () => {
  const result = commit(["tools/kore/src/a.ts"], []);
  assert.equal(result.status, 0);
  assert.match(
    result.calls,
    /^semgrep scan .*--config infra\/policies\/semgrep\/kore-node\.yaml --error .*tools\/kore\/src\/a\.ts$/m,
  );
  const lines = result.calls.split("\n");
  assert.match(
    lines[lines.findIndex((l) => l.startsWith("semgrep ")) - 1],
    /^mise exec -- /,
  );
});

test("a commit with no scannable source skips Semgrep", () => {
  for (const files of [
    ["README.md"],
    ["tools/kore/src/a.spec.ts"],
    ["infra/charts/c/values.yaml"],
  ]) {
    const result = commit(files, []);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.calls, /semgrep/, files.join());
  }
});

test("a Semgrep finding blocks the commit with one actionable line", () => {
  const result = commit(["tools/kore/src/a.ts"], ["semgrep"]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /^pre-commit: SAST found a problem in the staged files; run 'mise run scan-sast' and fix it\n$/,
  );
});

test("a missing semgrep blocks the commit by saying to install it, not that SAST found a problem", () => {
  const result = commit(["tools/kore/src/a.ts"], ["semgrep:version"]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /^pre-commit: semgrep is missing; run 'mise install'\n$/,
  );
  assert.doesNotMatch(result.calls, /semgrep scan/);
});

// A tree whose tests already passed runs none again: the test lock records a
// green run per tree and command, and says so when it skips. A changed tree
// is a different hash, so its related tests run as before.
test("committing the same staged tree again runs no tests and says so", () => {
  const result = commit(["tools/kore/src/a.ts"], [], { rerun: {} });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /tests already passed at tree [0-9a-f]{40}/);
  assert.doesNotMatch(result.npmCalls, /test:related/);
  assert.match(result.calls, /run check/, "the typecheck still runs");
});

test("a changed staged tree runs its related tests again", () => {
  const result = commit(["tools/kore/src/a.ts"], [], {
    rerun: { stage: ["tools/kore/src/b.ts"] },
  });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stderr, /already passed/);
  assert.match(result.npmCalls, /^kore run test:related .*src\/b\.ts/m);
});

test("a failing test blocks the commit and the next attempt still runs it", () => {
  const result = commit(["tools/kore/src/a.ts"], ["test:related"], {
    rerun: {},
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /already passed/);
  assert.match(result.npmCalls, /test:related/);
});

test("a crashing tree check still runs the tests and never blocks the commit", () => {
  const result = commit(["tools/kore/src/a.ts"], [], { gitCrash: true });
  assert.equal(result.status, 0);
  assert.match(result.npmCalls, /^kore run test:related /m);
  assert.doesNotMatch(result.stderr, /already passed/);
});

test("a crashing tree check does not hide a failing test", () => {
  const result = commit(["tools/kore/src/a.ts"], ["test:related"], {
    gitCrash: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /related unit tests failed/);
});
