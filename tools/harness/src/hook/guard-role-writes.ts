// Shared by the role guards: which commands change files, and the read-only
// finding. Owner approval to enforce the plan 11 role guards is recorded on
// #190 and #191 (2026-11-12).
import { basename } from "node:path";
import { commandOf } from "./guard-shell.js";
import { block, type Finding } from "./guard-verdict.js";

export const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

/** Commands whose job is to change files, the index, history or a pull request. */
const WRITERS = new Set([
  "tee",
  "cp",
  "mv",
  "rm",
  "rmdir",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "ln",
  "truncate",
  "dd",
  "install",
]);
const WRITING_GIT = new Set([
  "add",
  "commit",
  "push",
  "apply",
  "am",
  "checkout",
  "switch",
  "restore",
  "reset",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "stash",
  "clean",
  "rm",
  "mv",
  "worktree",
  "tag",
  "branch",
]);
const WRITING_GH = new Set(["merge", "close", "edit", "checkout"]);

export const readOnly = (what: string): Finding =>
  block(
    "role-read-only",
    `${what} changes files, and the concierge, reader, refiner, challenger, orchestrator and judge never write. ` +
      "Instead, report what needs changing: the concierge files it as an idea, the reader returns it in its summary, " +
      "the orchestrator hands it to a writer, the judge sends the change back, the refiner files an idea with `idea new` " +
      "and the challenger records a round with `idea challenge`.",
  );

/** Output redirects and the read-write `<>`, which opens a file for writing without truncating it. */
const FD_OPERATOR = /^(?:\d*>>?|&>>?|\d*<>)$/;
const harmless = (target: string | undefined): boolean =>
  target === "/dev/null" || target === "&1" || target === "&2";

/** Whether a word redirects output somewhere other than /dev/null or another stream, joined to its target or followed by it. */
const redirectsToFile = (segment: readonly string[]): boolean =>
  segment.some((word, index) => {
    if (FD_OPERATOR.test(word)) {
      return !harmless(segment[index + 1]);
    }
    const joined = /^(?:\d*>>?|&>>?|\d*<>)(.+)$/.exec(word);
    return joined !== null && !harmless(joined[1]);
  });

/** Whether a command writes: a writer, `sed -i`, writing git or gh verbs, or a redirect to a file. */
export function writes(segment: readonly string[]): boolean {
  const { name, args } = commandOf(segment);
  const verb = args.find((arg) => !arg.startsWith("-"));
  return (
    redirectsToFile(segment) ||
    WRITERS.has(name) ||
    (name === "sed" && args.some((arg) => /^-\w*i/.test(arg))) ||
    (name === "git" && verb !== undefined && WRITING_GIT.has(verb)) ||
    (name === "gh" &&
      args[0] === "pr" &&
      args[1] !== undefined &&
      WRITING_GH.has(args[1]))
  );
}

/** Same pattern as `PREFIXED` in guard-role.ts, shared here so the delivery guard can use it without a circular import; the contract step removes that copy. A segment that starts with `VAR=value` or an `env`-style wrapper: git and the harness read variables such as GIT_EXTERNAL_DIFF, PAGER and KORE_ROOT to run a program or move the ledger. */
export const PREFIXED =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=|(?:sudo|env|time|command|nohup|exec)$)/;

/** Builtins that change the shell's environment, aliases or options, or load a file into it, so a later segment runs with a variable such as KORE_ROOT that the guard never sees. */
const SHELL_STATE = new Set([
  "export",
  "declare",
  "typeset",
  "readonly",
  "local",
  "set",
  "unset",
  "alias",
  "source",
  ".",
]);

/** A segment whose command changes shell state or sources a file. */
export const changesShell = (segment: readonly string[]): boolean =>
  SHELL_STATE.has(segment[0] ?? "");

/** A command substitution or process substitution runs a command the segment check never sees. */
export const SUBSTITUTION = /\$\(|`|<\(|>\(/;

/** Commands that run another command line, or an interpreter on a string, past the segment check. */
const RUNS_OTHERS = new Set([
  "eval",
  "builtin",
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "xargs",
  "timeout",
  "nice",
  "ionice",
  "setsid",
  "stdbuf",
  "watch",
  "parallel",
  "doas",
  "su",
  "chroot",
]);

/** Subshells, groups and control keywords: they wrap commands the segment check would not look inside. */
const CONSTRUCT_WORDS = new Set([
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "select",
  "function",
  "!",
  "[[",
  "coproc",
]);

/** A segment that wraps or launches other command lines instead of running one plain command. */
export const wrapsCommands = (segment: readonly string[]): boolean => {
  const first = segment[0] ?? "";
  return (
    /^[({]/.test(first) ||
    RUNS_OTHERS.has(basename(first)) ||
    CONSTRUCT_WORDS.has(first)
  );
};

export const HARNESS = /^(\.\/)?skills\/bin\/harness\.mjs$/;
/** `--ledger <path>` makes a harness command append to any file, so a bounded role never passes it. */
const namesLedger = (args: readonly string[]): boolean =>
  args.some((arg) => arg === "--ledger" || arg.startsWith("--ledger="));

/** The command is the harness bundle and its `<domain> <command>` is on the role's list and names no --ledger; anything else, even a prefix match, is not. */
export const harnessAllowed = (
  name: string,
  args: readonly string[],
  allowed: readonly string[],
): boolean =>
  name === "node" &&
  HARNESS.test(args[0] ?? "") &&
  !namesLedger(args) &&
  allowed.includes(`${args[1] ?? ""} ${args[2] ?? ""}`);

/** `harness status`, a domain with no command word: bare or with `--json` only. A separate check, so no other role's allowlist can match it. */
export const harnessStatus = (name: string, args: readonly string[]): boolean =>
  name === "node" &&
  HARNESS.test(args[0] ?? "") &&
  args[1] === "status" &&
  args.length <= 3 &&
  (args[2] === undefined || args[2] === "--json");

/** `harness guardrail status`, bare or with `--json` only: how the concierge learns what waits for a person's approval. Its own check, so no allowlist can reach `guardrail request` or `guardrail deny`. */
export const harnessGuardrailStatus = (
  name: string,
  args: readonly string[],
): boolean =>
  name === "node" &&
  HARNESS.test(args[0] ?? "") &&
  args[1] === "guardrail" &&
  args[2] === "status" &&
  args.length <= 4 &&
  (args[3] === undefined || args[3] === "--json");
