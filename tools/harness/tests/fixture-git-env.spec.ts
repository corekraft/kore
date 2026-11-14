// Fixture git commands cannot write the real repository's config (#368).
// Under a git hook GIT_DIR names the real repository; a fixture's `git init`
// that inherits it rewrites the shared .git/config (core.bare = true), and a
// `git config` writes there too. Every call that may run git must therefore
// pass a stripped environment in its own options, not merely live in a file
// that strips somewhere else. The scanner is in fixture-git-scan.ts.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  stale,
  unexcused,
  unsafeSpawns,
  withoutLine,
} from "./fixture-git-scan.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const SKIPPED = new Set(["node_modules", ".git", "dist", "coverage"]);
const FIXTURE_FILE =
  /(\.spec\.ts|\.test\.mjs|-support\.ts|\.fixtures\.ts|eval\.mjs)$/;
/** A spec that only names git as data (a pattern or a fake), never as a process. */
const THIS_FILE = "tools/harness/tests/fixture-git-env.spec.ts";

/**
 * Calls the guard cannot pass yet: the writer role may not edit the hook tests
 * they live in (#440). Each is named by file and call, with how many such calls
 * the file has, so a second unsafe call in the same file is still reported.
 * Remove an entry once its call is fixed.
 */
const KNOWN_UNSAFE: Readonly<Record<string, number>> = {
  // #440: harness-launcher run() copies process.env, so GIT_DIR reaches the launcher.
  '.claude/hooks/harness-launcher.test.mjs spawnSync("sh"': 1,
  // #440: the `which git` probe passes no env, so it inherits GIT_DIR.
  '.claude/hooks/pre-commit.test.mjs spawnSync("which"': 1,
};

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
  const findings = () =>
    files
      .flatMap((path) =>
        unsafeSpawns(path, readFileSync(join(root, path), "utf8")),
      )
      .map(withoutLine);

  it("finds the fixtures it guards", () => {
    expect(files).toContain("tools/harness/tests/writer-sandbox-support.ts");
    expect(files).toContain(
      "tools/kore/src/runtime/nightly-script.fixtures.ts",
    );
    expect(files).toContain(".claude/evals/eval.mjs");
  });

  it("gives every call that may run git a clean env in its own options, but the named #440 calls", () => {
    expect(unexcused(findings(), KNOWN_UNSAFE)).toEqual([]);
  });

  it("reports a named #440 call once it is fixed, so the list shrinks", () => {
    expect(stale(findings(), KNOWN_UNSAFE)).toEqual([]);
  });
});

describe("the fixture git guard", () => {
  it("passes a git spawn whose own options strip GIT_*", () => {
    expect(
      unsafeSpawns(
        "a.spec.ts",
        `execFileSync("git", args, {\n  cwd: r,\n  env: cleanGitEnv(),\n});`,
      ),
    ).toEqual([]);
  });

  it("flags a git spawn that inherits process.env, even when the file strips elsewhere", () => {
    const file = `const clean = cleanGitEnv();\nspawnSync("git", ["init"], { cwd: r, env: process.env });`;
    expect(unsafeSpawns("a.spec.ts", file)).toEqual([
      'a.spec.ts:2 spawnSync("git"',
    ]);
  });

  it("flags a spawn that falls back to process.env when the caller passes no env", () => {
    const file = `execFile("claude", args, { env: options.env ?? process.env });`;
    expect(unsafeSpawns("e.mjs", file)).toEqual(['e.mjs:1 execFile("claude"']);
  });

  it("flags a spawn with no options object, since it inherits process.env", () => {
    expect(
      unsafeSpawns("a.spec.ts", `spawnSync("sh", ["-c", "git init"]);`),
    ).toEqual(['a.spec.ts:1 spawnSync("sh"']);
  });

  it("follows an options constant to the env it names", () => {
    const clean = `const cleanEnv = cleanGitEnv();\nconst opts = { cwd: r, env: cleanEnv };\nspawnSync("git", ["init"], opts);`;
    expect(unsafeSpawns("a.spec.ts", clean)).toEqual([]);
    const bare = `const opts = { cwd: r };\nspawnSync("git", ["init"], opts);`;
    expect(unsafeSpawns("a.spec.ts", bare)).toEqual([
      'a.spec.ts:2 spawnSync("git"',
    ]);
  });

  it("follows a spread of an options constant", () => {
    const file = `const env = cleanGitEnv();\nconst base = { cwd: r, env };\nspawnSync("git", ["init"], { ...base, encoding: "utf8" });`;
    expect(unsafeSpawns("a.spec.ts", file)).toEqual([]);
  });

  it("accepts a caller env that falls back to a stripped default", () => {
    const file = `const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([n]) => !n.startsWith("GIT_")));\nexecFile("claude", args, { env: options.env ?? GIT_ENV });`;
    expect(unsafeSpawns("e.mjs", file)).toEqual([]);
  });

  it("does not check a spawn of a command that cannot run git", () => {
    expect(
      unsafeSpawns(
        "a.spec.ts",
        `spawnSync("cat", [file], { encoding: "utf8" });\nspawnSync(process.execPath, [bundle]);`,
      ),
    ).toEqual([]);
  });
});

describe("the fixture git guard: env objects", () => {
  it("passes an explicit env that names only the variables it passes", () => {
    const file = `spawnSync("sh", ["-c", "git init"], { env: { PATH: process.env["PATH"] ?? "" } });`;
    expect(unsafeSpawns("a.spec.ts", file)).toEqual([]);
  });

  it("flags an explicit env that names a GIT_* variable", () => {
    const file = `spawnSync("git", ["init"], { env: { PATH: p, GIT_DIR: r } });`;
    expect(unsafeSpawns("a.spec.ts", file)).toEqual([
      'a.spec.ts:1 spawnSync("git"',
    ]);
  });

  it("flags an env that spreads a caller's object the guard cannot see", () => {
    const file = `spawnSync("sh", [s], { env: { ...extra, PATH: p } });`;
    expect(unsafeSpawns("a.spec.ts", file)).toEqual([
      'a.spec.ts:1 spawnSync("sh"',
    ]);
  });

  it("follows an env object constant that spreads a clean env", () => {
    const file = `const cleanEnv = cleanGitEnv();\nconst hookEnv = { ...cleanEnv, PATH: p };\nspawnSync("sh", [s], { env: hookEnv });`;
    expect(unsafeSpawns("a.spec.ts", file)).toEqual([]);
  });

  it("ignores a regular expression's exec method", () => {
    expect(
      unsafeSpawns(
        "a.spec.ts",
        `const m = /x/.exec(line);\nconst n = re.exec(text);`,
      ),
    ).toEqual([]);
  });

  it("flags a promisified git call that passes no env, whatever the callee is named", () => {
    const file = `const run = promisify(execFile);\nawait run("git", ["init"], { cwd: dir });`;
    expect(unsafeSpawns("a.spec.ts", file)).toEqual(['a.spec.ts:2 run("git"']);
  });

  it("passes a promisified git call whose own options strip GIT_*", () => {
    const file = `const run = promisify(execFile);\nawait run("git", ["init"], { cwd: dir, env: cleanGitEnv() });`;
    expect(unsafeSpawns("a.spec.ts", file)).toEqual([]);
  });

  it("flags a call to any name whose first argument is a may-run-git program", () => {
    expect(
      unsafeSpawns("a.spec.ts", `await runner("/usr/bin/git", ["init"]);`),
    ).toEqual(['a.spec.ts:1 runner("/usr/bin/git"']);
  });
});

describe("the fixture git guard: named sites", () => {
  const twice = `spawnSync("sh", ["-c", "a"]);\nspawnSync("sh", ["-c", "b"]);`;
  const key = 'a.spec.ts spawnSync("sh"';

  it("excuses a named site only up to its count, so a second unsafe spawn in the same file is reported", () => {
    const findings = unsafeSpawns("a.spec.ts", twice).map(withoutLine);
    expect(findings).toHaveLength(2);
    expect(unexcused(findings, { [key]: 1 })).toEqual([key]);
  });

  it("excuses every occurrence a count names", () => {
    const findings = unsafeSpawns("a.spec.ts", twice).map(withoutLine);
    expect(unexcused(findings, { [key]: 2 })).toEqual([]);
  });

  it("reports a named site whose count no longer matches, so a fixed site is dropped", () => {
    expect(stale([key], { [key]: 2 })).toEqual([key]);
    expect(stale([], { [key]: 1 })).toEqual([key]);
  });
});

describe("the fixture git guard: callees", () => {
  it("flags a promisified exec called through a call expression, with no env", () => {
    const file = `const out = await promisify(execFile)("git", ["init"], { cwd: dir });`;
    expect(unsafeSpawns("a.spec.ts", file)).toEqual(['a.spec.ts:1 )("git"']);
  });

  it("does not check an expect matcher that takes a bare program name", () => {
    expect(
      unsafeSpawns("a.spec.ts", `expect(runner.program).toBe("git");`),
    ).toEqual([]);
  });
});
