// Fixture git commands cannot write the real repository's config (#368).
// Under a git hook GIT_DIR names the real repository; a fixture's `git init`
// that inherits it rewrites the shared .git/config (core.bare = true), and a
// `git config` writes there too. Every test or fixture file that spawns git
// must therefore strip GIT_* from the child environment.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const SKIPPED = new Set(["node_modules", ".git", "dist", "coverage"]);
const FIXTURE_FILE =
  /(\.spec\.ts|\.test\.mjs|-support\.ts|\.fixtures\.ts|eval\.mjs)$/;
/** A real child process whose command is git: spawn("git", ...) in any form. */
const SPAWNS_GIT =
  /\b(?:spawnSync|spawn|execFileSync|execFile)\(\s*(?:["'`]git["'`]|git\b)/;
/** Evidence the child environment has no GIT_* variable. */
const STRIPS_GIT_ENV = /cleanGitEnv|startsWith\(["']GIT_["']\)/;
/** A spec that only names git as data (a pattern or a fake), never as a process. */
const THIS_FILE = "tools/harness/tests/fixture-git-env.spec.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED.has(entry.name)) {
      return [];
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return FIXTURE_FILE.test(entry.name) ? [path] : [];
  });
}

describe("fixture git commands", () => {
  const files = ["tools", ".claude"]
    .flatMap((dir) => sourceFiles(join(root, dir)))
    .map((path) => relative(root, path))
    .filter((path) => path !== THIS_FILE);

  it("finds the fixtures it guards", () => {
    expect(files).toContain("tools/harness/tests/writer-sandbox-support.ts");
    expect(files).toContain(
      "tools/kore/src/runtime/nightly-script.fixtures.ts",
    );
    expect(files).toContain(".claude/evals/eval.mjs");
  });

  it("strips GIT_* from the environment of every file that spawns git", () => {
    const unsafe = files.filter((path) => {
      const text = readFileSync(join(root, path), "utf8");
      return SPAWNS_GIT.test(text) && !STRIPS_GIT_ENV.test(text);
    });
    expect(unsafe).toEqual([]);
  });

  it("does not take a spawn for safe merely because a helper exists beside it", () => {
    // writer-sandbox-support.ts spawns git through a local helper, so the
    // helper itself must carry the env.
    const text = readFileSync(
      join(root, "tools/harness/tests/writer-sandbox-support.ts"),
      "utf8",
    );
    expect(text).toMatch(
      /execFileSync\("git", args, \{[^}]*env: cleanGitEnv\(\)/s,
    );
  });
});
