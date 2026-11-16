// The writer's worktree bound (role-worktree, ADR 0078): a path a writing command, a cd, a `git -C`
// or an inline interpreter names must stay inside the worktree, or in scratch space in tmp. The
// delivery guard (guard-role-delivery.ts) decides which calls reach this check; this module judges
// the paths they name.
import { isAbsolute, relative, resolve } from "node:path";
import { withoutHeredocBodies, codeStrings } from "./guard-text.js";
import { commandOf, splitSegments } from "./guard-shell.js";
import { writes } from "./guard-role-writes.js";
import { block, type Finding } from "./guard-verdict.js";

export const outsideWorktree = (what: string, root: string): Finding =>
  block(
    "role-worktree",
    `${what} reaches outside this worktree (${root}), and a writer works only in the worktree it was launched in. ` +
      "Instead, make the change inside the worktree, or report that it needs another piece of work.",
  );

/** An interpreter given inline code, or an editor told to work in place, which can write anything. */
export function runsInline(segment: readonly string[]): boolean {
  const { name, args } = commandOf(segment);
  return (
    (name === "node" && args.some((a) => ["-e", "--eval", "-p"].includes(a))) ||
    (/^python3?$/.test(name) && args.includes("-c")) ||
    (name === "perl" && args.some((a) => /^-\w*[eEip]/.test(a))) ||
    (name === "ruby" && args.includes("-e")) ||
    (/^g?awk$/.test(name) &&
      args.some((a) => a === "inplace" || a === "--in-place"))
  );
}

const SCRATCH = ["/tmp/", "/private/tmp/", "/var/folders/", "/dev/"];
/**
 * Paths in a word: an absolute or home path that starts the word or follows a character no
 * path holds (`=`, `>`, `(`, a quote), and any `..` segment. A slash inside a word (`feat/x`
 * in a branch name) does not start a path, so an ordinary branch push is not read as an
 * absolute one.
 */
const ABSOLUTE = /(?:^|[^\w.@~/-])((?:~|\/)[\w.@~/-]*)/g;
const PARENT = /[\w.@~/-]*\.\.[\w.@~/-]*/g;

/** The paths a word names. */
function pathsIn(word: string): string[] {
  const text = word.replace(/^(?:\d*>>?|&>>?)/, "");
  return [
    ...[...text.matchAll(ABSOLUTE)].flatMap((m) => (m[1] ? [m[1]] : [])),
    ...(text.match(PARENT) ?? []).filter((p) => p.split("/").includes("..")),
  ];
}

/** Whether a path, read from the directory `dir` the command runs in, is outside the worktree and not scratch space in tmp. */
export function outside(
  root: string,
  path: string,
  dir: string = root,
): boolean {
  if (path.startsWith("~")) {
    return true;
  }
  const full = resolve(dir, path);
  const from = relative(root, full);
  const within = from === "" || (!from.startsWith("..") && !isAbsolute(from));
  return (
    !within &&
    !SCRATCH.some((tmp) => full.startsWith(tmp) || `${full}/` === tmp)
  );
}

const INLINE_CODE_FLAGS = new Set(["-e", "--eval", "-p", "-c"]);

/**
 * The words of a segment that may name a path. A word with whitespace is text (a commit message, a
 * `--body`), not a path, unless the segment runs inline code. In inline code only the string
 * literals name a path, so a regex literal such as `/restrict|Pattern/` is not read as one.
 */
function pathWords(segment: readonly string[]): string[] {
  if (!runsInline(segment)) {
    return segment.filter((word) => !/\s/.test(word));
  }
  const { args } = commandOf(segment);
  const flag = args.findIndex((arg) => INLINE_CODE_FLAGS.has(arg));
  const code = flag < 0 ? undefined : args[flag + 1];
  // Without a code word to read (a combined flag, say), every word stays a candidate, as before.
  return code === undefined
    ? [...segment]
    : segment.flatMap((word) => (word === code ? codeStrings(word) : [word]));
}

/** The first path in a writing command, cd or `git -C` that leaves the worktree. */
function escapes(
  segment: readonly string[],
  root: string,
  dir: string,
): string | undefined {
  const { name, args } = commandOf(segment);
  const target = name === "git" ? args[args.indexOf("-C") + 1] : args[0];
  if (
    (name === "cd" || (name === "git" && args.includes("-C"))) &&
    target !== undefined &&
    outside(root, target, dir)
  ) {
    return target;
  }
  if (!writes(segment) && !runsInline(segment)) {
    return undefined;
  }
  return pathWords(segment)
    .flatMap(pathsIn)
    .find((path) => outside(root, path, dir));
}

/**
 * The first segment that leaves the worktree. Relative paths resolve from the directory
 * the hook ran in, and from where an earlier cd in the same command left the shell.
 */
function leavesWorktree(
  segments: readonly (readonly string[])[],
  root: string,
  cwd: string,
): readonly string[] | undefined {
  // A relative directory would resolve against the hook process's own, so it counts as the root.
  let dir = isAbsolute(cwd) ? cwd : root;
  for (const segment of segments) {
    if (escapes(segment, root, dir) !== undefined) {
      return segment;
    }
    const { name, args } = commandOf(segment);
    if (name === "cd" && args[0] !== undefined && args[0] !== "-") {
      dir = resolve(dir, args[0]);
    }
  }
  return undefined;
}

/**
 * The finding for a writer's command that leaves the worktree, or null. Heredoc bodies are text,
 * not commands, unless a shell or interpreter runs them, so they are taken out first.
 */
export function leavingWorktree(
  command: string,
  root: string,
  cwd: string,
): Finding {
  const leaving = leavesWorktree(
    splitSegments(withoutHeredocBodies(command)),
    root,
    cwd,
  );
  return leaving === undefined
    ? null
    : outsideWorktree(`\`${leaving.join(" ")}\``, root);
}
