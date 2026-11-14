// Which hook test files a writer may name in Bash: one plain test, staged with `git add` or
// `git commit` (#576), so it can be committed after its edit (#440, ADR 0100).
import { isAbsolute, join, relative } from "node:path";
import * as links from "./guard-role-links.js";
import { splitSegments } from "./guard-shell.js";

/** A hook's test file: a literal name directly in `.claude/hooks` that ends `.test.mjs`. Writers may change these (#440, ADR 0100). */
const HOOK_TEST = /^\.claude\/hooks\/[A-Za-z0-9_][A-Za-z0-9_.-]*\.test\.mjs$/;
/** A word the guard cannot resolve by reading it: a climb, glob, variable or brace. */
export const UNRESOLVED = /\.\.|[*$?[{}]/;

/** Whether a word is a regular hook test file by its literal name: no glob, variable, substitution, climb or brace, and nothing on disk that is a symlink or folder. */
export function isHookTest(
  root: string,
  word: string,
  exists = false,
): boolean {
  if (isAbsolute(word) && UNRESOLVED.test(word)) {
    return false;
  }
  const inside = isAbsolute(word) ? relative(root, word) : word;
  const onDisk = join(root, inside);
  return (
    HOOK_TEST.test(inside) &&
    (exists ? links.isRegularFile(onDisk) : !links.isLinkOrFolder(onDisk))
  );
}

/** Whether a call is one plain `git add <hook test>` or `git commit [-m <message>] [--] <hook test>`: a writer stages the test it edited, and nothing else (#576). Any other flag, a second path, a substitution or a chained command is not, and falls to the guard checks. */
export function stagesHookTest(root: string, command: string): boolean {
  const segments = splitSegments(command);
  const [git = "", verb = "", ...args] = segments[0] ?? [];
  if (
    segments.length !== 1 ||
    git !== "git" ||
    !["add", "commit"].includes(verb) ||
    /[$`]|[<>]\(/.test(command)
  ) {
    return false;
  }
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (verb === "commit" && (arg === "-m" || arg === "--message")) {
      i++;
    } else if (
      !(verb === "commit" && arg.startsWith("--message=")) &&
      arg !== "--"
    ) {
      paths.push(arg);
    }
  }
  return paths.length === 1 && isHookTest(root, paths[0] as string, true);
}
