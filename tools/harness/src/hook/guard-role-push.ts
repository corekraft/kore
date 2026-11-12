// Pushes to main by a role-bound pane (see guard-role-merge.ts for why): by a refspec, by
// where the branch tracks, or through git configuration that redirects a push.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { expand, isDash, MAIN } from "./guard-role-merge.js";
import { commandOf } from "./guard-shell.js";

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

const GIT_VALUED = new Set(["-C", "--git-dir", "--work-tree", "--namespace"]);
const GIT_CONFIG = new Set(["-c", "--config-env"]);

export interface GitCall {
  /** The `key` of each `-c key=value` or `--config-env=key=ENV` given before the subcommand. */
  config: string[];
  sub: string | undefined;
  args: string[];
}

/** A command line that runs git: its configuration keys, subcommand and the words after it. */
export function gitCall(line: readonly string[]): GitCall | undefined {
  const { name, args } = commandOf(line);
  if (name !== "git") {
    return undefined;
  }
  const config: string[] = [];
  let at = 0;
  while (isDash(args[at])) {
    const word = args[at] as string;
    const [flag = "", inline] = word.split(/=(.*)/s);
    const value = GIT_CONFIG.has(flag) ? (inline ?? args[at + 1] ?? "") : "";
    if (GIT_CONFIG.has(flag)) {
      config.push(value.split("=")[0] ?? "");
    }
    at +=
      inline === undefined && (GIT_VALUED.has(word) || GIT_CONFIG.has(word))
        ? 2
        : 1;
  }
  return { config, sub: args[at], args: args.slice(at + 1) };
}

/** Configuration keys that choose where a push goes. */
export const PUSH_KEY = /^(remote|push|branch)\./i;

/** The words after `push`, when a command line is a `git push`. */
function pushArgs(line: readonly string[]): string[] | undefined {
  const call = gitCall(line);
  return call?.sub === "push" ? call.args : undefined;
}

/** A `git push` run with `-c` configuration that redirects it (remote.*.push, push.*, branch.*). */
function pushConfigured(line: readonly string[]): boolean {
  const call = gitCall(line);
  return call?.sub === "push" && call.config.some((key) => PUSH_KEY.test(key));
}

const sendsToMain = (target: string | undefined): boolean =>
  target === MAIN || (target?.includes("*") ?? false);

/**
 * The refspecs of a push: the words after the remote. `--repo=<remote>` and `--repo <remote>`
 * name the remote too, so every other positional word is then a refspec.
 */
function refspecsOf(words: readonly string[]): string[] {
  const at = words.indexOf("--repo");
  const named = at >= 0 || words.some((w) => w.startsWith("--repo="));
  const positional = words.filter(
    (w, i) => !w.startsWith("-") && !(at >= 0 && i === at + 1),
  );
  return named ? positional : positional.slice(1);
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

/** Whether a segment, through its wrappers, names main as a push target (no repository is read). */
export const pushesToMain = (segment: readonly string[]): boolean => {
  const lines = expand(segment);
  // xargs supplies the refspec at run time, so a push it runs may go anywhere.
  const viaXargs = lines.some(
    (line, at) =>
      basename(line[0] ?? "") === "xargs" &&
      lines.slice(at + 1).some((inner) => pushArgs(inner) !== undefined),
  );
  return (
    viaXargs || lines.some((line) => namesMain(line) || pushConfigured(line))
  );
};

/** Whether a segment pushes with the target left to the branch, and the branch is or tracks main. */
export const pushesByTracking = (
  segment: readonly string[],
  root: string,
): boolean => expand(segment).some((line) => tracksMain(line, root));
