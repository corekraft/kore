// Fixture git commands cannot write the real repository's config (#368).
// Under a git hook GIT_DIR names the real repository; a fixture's `git init`
// that inherits it rewrites the shared .git/config (core.bare = true), and a
// `git config` writes there too. Every spawn that may run git must therefore
// pass a stripped environment in its own options, not merely live in a file
// that strips somewhere else.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const SKIPPED = new Set(["node_modules", ".git", "dist", "coverage"]);
const FIXTURE_FILE =
  /(\.spec\.ts|\.test\.mjs|-support\.ts|\.fixtures\.ts|eval\.mjs)$/;
/** A spec that only names git as data (a pattern or a fake), never as a process. */
const THIS_FILE = "tools/harness/tests/fixture-git-env.spec.ts";

/** A child process call; the lookbehind keeps `regex.exec(` and `x.spawn(` out. */
const SPAWN =
  /(?<![\w.$])(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\(/g;
/**
 * A program that runs git, or runs commands that may: git itself, a shell, a
 * sandbox, or claude. Other programs (helm, yq, esbuild, a credential helper)
 * cannot write the repository's config, so their spawns need no clean env.
 */
const MAY_RUN_GIT =
  /^(?:["'`](?:git|sh|bash|\/bin\/bash|sandbox-exec|\/usr\/bin\/sandbox-exec|claude)["'`])$/;
/** A spawn whose arguments name git hands git to the child whatever the program. */
const NAMES_GIT = /\bgit\b/;
/** The text of a value that names a stripped environment. */
const STRIPPED_DEFINITION =
  /cleanGitEnv\(|withoutGit\(|startsWith\(["']GIT_["']\)/;

const QUOTES = new Set(['"', "'", "`"]);
const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);

/**
 * Walks the bracket group opening at `open`, calling onComma with the index of
 * each comma directly inside it; returns the index of the bracket that closes it.
 */
function walk(
  text: string,
  open: number,
  onComma: (index: number) => void,
): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (quote !== null) {
      if (ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
    } else if (QUOTES.has(ch)) {
      quote = ch;
    } else if (OPENERS.has(ch)) {
      depth++;
    } else if (CLOSERS.has(ch)) {
      depth--;
      if (depth === 0) {
        return i;
      }
    } else if (ch === "," && depth === 1) {
      onComma(i);
    }
  }
  return text.length - 1;
}

/** The index of the bracket that closes the one opening at `open`. */
function closeOf(text: string, open: number): number {
  return walk(text, open, () => undefined);
}

/** The top-level parts of the bracketed group opening at `open`, split at commas. */
function partsOf(text: string, open: number): string[] {
  const commas: number[] = [];
  const close = walk(text, open, (index) => commas.push(index));
  const bounds = [open, ...commas, close];
  return bounds
    .slice(0, -1)
    .map((start, i) => text.slice(start + 1, bounds[i + 1]).trim())
    .filter((part) => part !== "");
}

/** The expression a `const NAME = …` in the file assigns, or null when there is none. */
function definitionOf(name: string, file: string): string | null {
  const escaped = name.replace(/\$/g, "\\$");
  const match = new RegExp(
    `\\b(?:const|let|var)\\s+${escaped}\\b[^=;]*=\\s*`,
  ).exec(file);
  if (match === null) {
    return null;
  }
  const start = match.index + match[0].length;
  if (file[start] === "{") {
    return file.slice(start, closeOf(file, start) + 1);
  }
  const end = file.indexOf(";", start);
  return file.slice(start, end === -1 ? undefined : end).trim();
}

/** The env value an options object sets, following `...spread` constants; undefined when none. */
function optionEnv(file: string, object: string): string | undefined {
  let env: string | undefined;
  for (const part of partsOf(object, 0)) {
    const spread = /^\.\.\.\s*([\w$]+)$/.exec(part);
    if (spread?.[1] !== undefined) {
      const definition = definitionOf(spread[1], file);
      const inner =
        definition?.startsWith("{") === true
          ? optionEnv(file, definition)
          : undefined;
      env = inner ?? env;
      continue;
    }
    const keyed = /^env\s*(?::([\s\S]*))?$/.exec(part);
    if (keyed !== null) {
      env = keyed[1]?.trim() ?? "env";
    }
  }
  return env;
}

const MAX_DEPTH = 5;
const GIT_KEY = /^["']?GIT_/;

/**
 * Whether a value is a clean environment: a constant defined as one, an object
 * that spreads only clean environments and names no GIT_* key, or an
 * expression that strips GIT_*. A fallback (`x ?? y`) is judged by `y`. An
 * unresolved spread is not clean: the guard cannot see what it carries.
 */
function stripsGit(file: string, value: string, depth = 0): boolean {
  const trimmed = value.trim();
  const last = trimmed.startsWith("{")
    ? trimmed
    : (trimmed.split("??").pop() ?? "").trim();
  if (depth > MAX_DEPTH) {
    return false;
  }
  if (/^[\w$]+$/.test(last)) {
    const definition = definitionOf(last, file);
    if (definition === null) {
      return false;
    }
    return definition.startsWith("{")
      ? stripsGit(file, definition, depth + 1)
      : STRIPPED_DEFINITION.test(definition);
  }
  if (last.startsWith("{")) {
    return partsOf(last, 0).every((part) =>
      part.startsWith("...")
        ? stripsGit(file, part.slice(3), depth + 1)
        : !GIT_KEY.test(part),
    );
  }
  return STRIPPED_DEFINITION.test(last);
}

/** The options object of a spawn, given inline or through a constant. */
function objectOf(file: string, expression: string): string | null {
  if (expression.startsWith("{")) {
    return expression;
  }
  if (/^[\w$]+$/.test(expression)) {
    const definition = definitionOf(expression, file);
    return definition?.startsWith("{") === true ? definition : null;
  }
  return null;
}

/**
 * The spawns in one file that may run git but do not pass a clean env in
 * their own options (or in a constant those options name). A spawn without
 * options is unsafe: it inherits process.env.
 */
function unsafeSpawns(path: string, file: string): string[] {
  const found: string[] = [];
  for (const match of file.matchAll(SPAWN)) {
    const at = match.index ?? 0;
    const args = partsOf(file, at + match[0].length - 1);
    const command = args[0] ?? "";
    if (!MAY_RUN_GIT.test(command) && !NAMES_GIT.test(args[1] ?? "")) {
      continue;
    }
    const object = args[2] === undefined ? null : objectOf(file, args[2]);
    const env = object === null ? undefined : optionEnv(file, object);
    if (env === undefined || !stripsGit(file, env)) {
      const line = file.slice(0, at).split("\n").length;
      found.push(`${path}:${line} ${match[0]}${command}`);
    }
  }
  return found;
}

/**
 * Spawns the guard cannot pass yet: the writer role may not edit the hook tests
 * they live in (#440). Each is named by file and call, so the spec still fails
 * for any other site. Remove an entry once its site is fixed.
 */
const KNOWN_UNSAFE = [
  // #440: harness-launcher run() copies process.env, so GIT_DIR reaches the launcher.
  '.claude/hooks/harness-launcher.test.mjs spawnSync("sh"',
  // #440: the `which git` probe passes no env, so it inherits GIT_DIR.
  '.claude/hooks/pre-commit.test.mjs spawnSync("which"',
];

/** A finding without its line, so a named site survives edits above it. */
const withoutLine = (finding: string): string => finding.replace(/:\d+ /, " ");

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

  it("gives every spawn that may run git a clean env in its own options, but the named #440 sites", () => {
    const unsafe = files
      .flatMap((path) =>
        unsafeSpawns(path, readFileSync(join(root, path), "utf8")),
      )
      .map(withoutLine);
    expect(unsafe.filter((finding) => !KNOWN_UNSAFE.includes(finding))).toEqual(
      [],
    );
  });

  it("drops a named #440 site from the list once it is fixed", () => {
    const unsafe = files
      .flatMap((path) =>
        unsafeSpawns(path, readFileSync(join(root, path), "utf8")),
      )
      .map(withoutLine);
    expect(KNOWN_UNSAFE.filter((finding) => !unsafe.includes(finding))).toEqual(
      [],
    );
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
});
