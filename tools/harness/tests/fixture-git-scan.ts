// The scanner behind fixture-git-env.spec.ts: it finds every call that may run
// git and reports the ones whose own options do not strip GIT_* (#368). It is
// not a fixture itself (its name is not in the spec's file pattern), so the
// guard does not scan this file.

/**
 * A call: an identifier followed by `(`, whatever it is named (`spawnSync`,
 * `run` from promisify, `helper`), or the `(` after a closing `)`, as in
 * `promisify(execFile)("git", …)`. The lookbehind keeps `1foo(` out.
 */
const CALL = /(?<![\w$])([\w$]+)\(|\)\(/g;
/** The callees that spawn a process and take its options as the third argument. */
const SPAWN_NAMES = new Set([
  "spawnSync",
  "spawn",
  "execFileSync",
  "execFile",
  "execSync",
  "exec",
]);
/** git itself, by bare name or path. Any callee that starts git is checked. */
const GIT_PROGRAM = /^(?:["'`](?:\/[\w./-]+\/)?git["'`])$/;
/**
 * A spawn callee's program may run git: git, a shell, a sandbox, or claude, by
 * bare name or path. Other programs (helm, yq, esbuild, a credential helper)
 * cannot write the repository's config, so their spawns need no clean env.
 */
const MAY_RUN_GIT =
  /^(?:["'`](?:(?:\/[\w./-]+\/)?(?:git|sh|bash|sandbox-exec)|claude)["'`])$/;
/** A spawn whose arguments name git hands git to the child whatever the program. */
const NAMES_GIT = /\bgit\b/;
/** The text of a value that names a stripped environment. */
const STRIPPED_DEFINITION =
  /cleanGitEnv\(|withoutGit\(|startsWith\(["']GIT_["']\)/;

const QUOTES = new Set(['"', "'", "`"]);
const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);
const MAX_DEPTH = 5;
const GIT_KEY = /^["']?GIT_/;

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
 * Whether a call may run git. A spawn callee is checked when its program may
 * run git, or its arguments name git. Any other callee (a promisified exec, a
 * helper) is checked when it starts git and passes arguments; a bare literal
 * such as an expect matcher's `toBe("sh")` is not a call that runs anything.
 */
function mayRunGit(name: string, args: string[]): boolean {
  const command = args[0] ?? "";
  if (SPAWN_NAMES.has(name)) {
    return MAY_RUN_GIT.test(command) || NAMES_GIT.test(args[1] ?? "");
  }
  return args.length >= 2 && GIT_PROGRAM.test(command);
}

/**
 * The calls in one file that may run git but do not pass a clean env in their
 * own options (or in a constant those options name). A call with no options
 * object is unsafe: it inherits process.env.
 */
export function unsafeSpawns(path: string, file: string): string[] {
  const found: string[] = [];
  for (const match of file.matchAll(CALL)) {
    const at = match.index ?? 0;
    const name = match[1] ?? "";
    const args = partsOf(file, at + match[0].length - 1);
    if (!mayRunGit(name, args)) {
      continue;
    }
    const object = args[2] === undefined ? null : objectOf(file, args[2]);
    const env = object === null ? undefined : optionEnv(file, object);
    if (env === undefined || !stripsGit(file, env)) {
      const line = file.slice(0, at).split("\n").length;
      found.push(`${path}:${line} ${match[0]}${args[0] ?? ""}`);
    }
  }
  return found;
}

/** A finding without its line, so a named site survives edits above it. */
export const withoutLine = (finding: string): string =>
  finding.replace(/:\d+ /, " ");

/**
 * The findings a named site does not excuse. A named site excuses exactly its
 * count of matching findings, so a second unsafe call in the same file is
 * reported.
 */
export function unexcused(
  findings: readonly string[],
  known: Readonly<Record<string, number>>,
): string[] {
  const left = new Map(Object.entries(known));
  return findings.filter((finding) => {
    const count = left.get(finding) ?? 0;
    if (count > 0) {
      left.set(finding, count - 1);
      return false;
    }
    return true;
  });
}

/** The named sites whose count no longer matches the findings: fixed ones, or ones that grew. */
export function stale(
  findings: readonly string[],
  known: Readonly<Record<string, number>>,
): string[] {
  return Object.entries(known)
    .filter(
      ([key, count]) =>
        findings.filter((finding) => finding === key).length !== count,
    )
    .map(([key]) => key);
}
