// What counts as a merge, or a push to main, for the role-bound panes (ADR 0078, plan 11
// Step 5). The merge tool is the judge's only merge, and the owner account bypasses the
// `main` ruleset, so a push to main lands unreviewed: every form that reaches main is
// found here, through the wrappers that hide it (env, a shell's -c, xargs, eval, time, sudo).
//
// The limit: a writer has a full shell and can always write a script that does what a
// blocked command does, so these guards are defence in depth, not the boundary. The control
// that actually stops an unreviewed change reaching main is the `main` ruleset without
// owner bypass, which the owner decides separately.
import { basename } from "node:path";
import { commandOf, splitSegments } from "./guard-shell.js";

const WRAPPERS = new Set(["sudo", "env", "time", "command", "nohup", "exec"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
export const MAIN = "main";
const MAX_DEPTH = 5;
/** Each wrapper's options that take a value in the next word; every other dash word is a flag. */
const WRAPPER_VALUED: Record<string, ReadonlySet<string>> = {
  env: new Set(["-u", "-C", "-S", "--unset", "--chdir"]),
  sudo: new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U"]),
  time: new Set(["-f", "-o", "--format", "--output"]),
  exec: new Set(["-a"]),
};
const XARGS_VALUED = new Set(["-I", "-n", "-P", "-L", "-s", "-E", "-d", "-a"]);

export const isDash = (word: string | undefined): boolean =>
  word !== undefined && word.startsWith("-");

/** The words after any leading `VAR=value`, or wrapper (sudo, env, time, command, nohup, exec) and its options. */
function unwrapped(segment: readonly string[]): string[] {
  let rest = [...segment];
  for (;;) {
    const word = rest[0] ?? "";
    const wrapper = WRAPPERS.has(basename(word));
    if (!wrapper && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      return rest;
    }
    rest = rest.slice(1);
    const valued = WRAPPER_VALUED[basename(word)] ?? new Set<string>();
    while (wrapper && isDash(rest[0])) {
      rest = rest.slice(valued.has(rest[0] ?? "") ? 2 : 1);
    }
  }
}

/** The script a shell is given with -c (`-c`, `-lc`, `-ec`), when it is given one. */
function shellScript(args: readonly string[]): string | undefined {
  const at = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg));
  return at < 0 ? undefined : args[at + 1];
}

/** The command xargs runs, after its own options. */
function xargsCommand(args: readonly string[]): string[] {
  let at = 0;
  while (isDash(args[at])) {
    at += XARGS_VALUED.has(args[at] ?? "") ? 2 : 1;
  }
  return args.slice(at);
}

/** The command lines a segment may run: itself, or the line inside env, a shell's -c, xargs or eval. */
export function expand(segment: readonly string[], depth = 0): string[][] {
  const rest = unwrapped(segment);
  const name = basename(rest[0] ?? "");
  const args = rest.slice(1);
  const inner = (words: readonly string[]): string[][] =>
    words.length === 0 || depth >= MAX_DEPTH ? [] : expand(words, depth + 1);
  let script: string | undefined;
  if (SHELLS.has(name)) {
    script = shellScript(args);
  } else if (name === "eval") {
    script = args.join(" ");
  }
  if (script !== undefined) {
    return [rest, ...splitSegments(script).flatMap(inner)];
  }
  return name === "xargs" ? [rest, ...inner(xargsCommand(args))] : [rest];
}

/** REST routes that merge: a pull request, a branch into a branch, or an upstream into a fork. */
/** The command text inside each `$(...)`, `<(...)`, `>(...)` and pair of backticks, nested ones included. */
export function substituted(command: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === "`") {
      const close = command.indexOf("`", i + 1);
      const end = close < 0 ? command.length : close;
      const inner = command.slice(i + 1, end);
      found.push(inner, ...substituted(inner));
      i = end;
    } else if ("$<>".includes(char ?? "") && command[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      while (j < command.length && depth > 0) {
        if (command[j] === "(") {
          depth++;
        } else if (command[j] === ")") {
          depth--;
        }
        j++;
      }
      const inner = command.slice(i + 2, depth === 0 ? j - 1 : j);
      found.push(inner, ...substituted(inner));
      i = j - 1;
    }
  }
  return found;
}

/** The command's segments, and those of every command substituted into it: a token or a merge hidden in `$(...)` is still run. */
export const withSubstitutions = (command: string): string[][] =>
  [command, ...substituted(command)].flatMap(splitSegments);

const MERGE_API = /\/pulls\/\d+\/merge\b|\/merges\b|\/merge-upstream\b/;
const MERGE_MUTATION = /mergePullRequest|enablePullRequestAutoMerge/i;

/** The arguments with `-R <repo>` and `--repo <repo>` dropped, so `gh -R x pr merge` reads as `gh pr merge`. */
const withoutRepo = (args: readonly string[]): string[] =>
  args.flatMap((arg, i) =>
    ["-R", "--repo"].includes(args[i - 1] ?? "") ||
    ["-R", "--repo"].includes(arg) ||
    arg.startsWith("--repo=")
      ? []
      : [arg],
  );

/** `gh api graphql` that names a merge mutation, or hides its query in a file the guard cannot read. */
function graphqlMerges(args: readonly string[]): boolean {
  return (
    args[0] === "api" &&
    args[1] === "graphql" &&
    (args.some((arg) => MERGE_MUTATION.test(arg)) ||
      args.some((arg) => /(^|=)@/.test(arg)) ||
      args.includes("--input"))
  );
}

/** Whether one command line merges a pull request by `gh`, through the REST or GraphQL API. */
function ghMerges(line: readonly string[]): boolean {
  const { name, args } = commandOf(line);
  if (name !== "gh") {
    return false;
  }
  const plain = withoutRepo(args);
  return (
    (plain[0] === "pr" && plain[1] === "merge") ||
    (args[0] === "api" && args.some((arg) => MERGE_API.test(arg))) ||
    graphqlMerges(args)
  );
}

/** Whether a segment, through its wrappers, merges a PR. */
export const mergesPr = (segment: readonly string[]): boolean =>
  expand(segment).some(ghMerges);

/** Whether a segment runs the judge's merge or send-back tool, through its wrappers. */
export const runsJudgeTool = (
  segment: readonly string[],
  harness: RegExp,
): boolean =>
  expand(segment).some((line) => {
    const { name, args } = commandOf(line);
    return (
      name === "node" &&
      harness.test(args[0] ?? "") &&
      args[1] === "judge" &&
      ["merge", "send-back"].includes(args[2] ?? "")
    );
  });
