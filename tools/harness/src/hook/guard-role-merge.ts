// What counts as a merge, or a push to main, for the role-bound panes (ADR 0078, plan 11
// Step 5). The merge tool is the judge's only merge, and the owner account bypasses the
// `main` ruleset, so a push to main lands unreviewed: every form that reaches main is
// found here, through the wrappers that hide it (env, a shell's -c, xargs, eval).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { commandOf, splitSegments } from "./guard-shell.js";

const WRAPPERS = new Set(["sudo", "env", "time", "command", "nohup", "exec"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const MAX_DEPTH = 5;
/** `env` and `xargs` options that take a value in the next word. */
const ENV_VALUED = new Set(["-u", "-C", "-S", "--unset", "--chdir"]);
const XARGS_VALUED = new Set(["-I", "-n", "-P", "-L", "-s", "-E", "-d", "-a"]);
const MAIN = "main";

const isDash = (word: string | undefined): boolean =>
  word !== undefined && word.startsWith("-");

/** The words after any leading `VAR=value`, sudo, env (and its options), time, command, nohup and exec. */
function unwrapped(segment: readonly string[]): string[] {
  let rest = [...segment];
  for (;;) {
    const word = rest[0] ?? "";
    const wrapper = WRAPPERS.has(basename(word));
    if (!wrapper && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      return rest;
    }
    rest = rest.slice(1);
    while (wrapper && basename(word) === "env" && isDash(rest[0])) {
      rest = rest.slice(ENV_VALUED.has(rest[0] ?? "") ? 2 : 1);
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

const MERGE_API = /\/pulls\/\d+\/merge\b/;
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

export interface Branches {
  current: string | undefined;
  /** The branch `git push` sends the current one to when no target is named. */
  tracked: string | undefined;
}

/** The environment without GIT_*: a GIT_DIR in the hook's environment must not point these reads at another repository. */
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );

const git = (root: string, args: string[]): string | undefined => {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      env: cleanEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15000,
    }).trim();
  } catch {
    return undefined;
  }
};

const branchName = (ref: string): string =>
  ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;

/** The checked-out branch and the one it tracks, read from the repository; undefined when it cannot be read. */
export function branchesOf(root: string): Branches {
  const current = git(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const merge =
    current === undefined || current === ""
      ? undefined
      : git(root, ["config", "--get", `branch.${current}.merge`]);
  return {
    current: current === "" ? undefined : current,
    tracked:
      merge === undefined || merge === "" ? undefined : branchName(merge),
  };
}

const GIT_VALUED = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
]);

/** The words after `push`, when a command line is a `git push`. */
function pushArgs(line: readonly string[]): string[] | undefined {
  const { name, args } = commandOf(line);
  if (name !== "git") {
    return undefined;
  }
  let at = 0;
  while (isDash(args[at])) {
    at += GIT_VALUED.has(args[at] as string) ? 2 : 1;
  }
  return args[at] === "push" ? args.slice(at + 1) : undefined;
}

const sendsToMain = (target: string | undefined): boolean =>
  target === MAIN || (target?.includes("*") ?? false);

/** The refspec targets of a push, and whether any of them is the branch it runs from. */
function refspecsOf(words: readonly string[]): string[] {
  return words.filter((w) => !w.startsWith("-")).slice(1);
}

/** Whether a push names main, or every branch, in its words: no repository is read. */
function namesMain(line: readonly string[]): boolean {
  const words = pushArgs(line);
  if (words === undefined) {
    return false;
  }
  return (
    words.some((w) => w === "--all" || w === "--mirror") ||
    refspecsOf(words).some((spec) =>
      sendsToMain(
        branchName(
          (spec.startsWith("+") ? spec.slice(1) : spec).split(":").at(-1) ?? "",
        ),
      ),
    )
  );
}

/**
 * Whether a push that leaves its target to the branch (`git push`, `git push origin`,
 * `... HEAD`) sends to main, because the branch is main or tracks it. Fails closed when the
 * branch cannot be read.
 */
function tracksMain(line: readonly string[], root: string): boolean {
  const words = pushArgs(line);
  if (words === undefined) {
    return false;
  }
  const refspecs = refspecsOf(words);
  const headOnly = refspecs.every((spec) => spec === "HEAD");
  if (!headOnly) {
    return false;
  }
  // A root that does not exist is no worktree, so there is no branch to track; a real
  // one whose branch cannot be read (a detached HEAD) fails closed below.
  if (!existsSync(root)) {
    return false;
  }
  const { current, tracked } = branchesOf(root);
  return current === undefined || sendsToMain(current) || sendsToMain(tracked);
}

/** Whether a segment, through its wrappers, merges a PR. */
export const mergesPr = (segment: readonly string[]): boolean =>
  expand(segment).some(ghMerges);

/** Whether a segment, through its wrappers, names main as a push target (no repository is read). */
export const pushesToMain = (segment: readonly string[]): boolean => {
  const lines = expand(segment);
  // xargs supplies the refspec at run time, so a push it runs may go anywhere.
  const viaXargs = lines.some(
    (line, at) =>
      basename(line[0] ?? "") === "xargs" &&
      lines.slice(at + 1).some((inner) => pushArgs(inner) !== undefined),
  );
  return viaXargs || lines.some(namesMain);
};

/** Whether a segment pushes with the target left to the branch, and the branch is or tracks main. */
export const pushesByTracking = (
  segment: readonly string[],
  root: string,
): boolean => expand(segment).some((line) => tracksMain(line, root));

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
