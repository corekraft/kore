// Shared by the role guards: which commands change files, and the read-only
// finding. Owner approval to enforce the plan 11 role guards is recorded on
// #190 and #191 (2026-11-12).
import { basename } from "node:path";
import { commandLookup } from "./guard-role-reads.js";
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
    `${what} changes files, and the reader and judge never write. ` +
      "Instead, report what needs changing: the reader returns it in its summary " +
      "and the judge sends the change back.",
  );

/** REPL runs JavaScript the guard does not read, so a read-only role that runs it is refused whatever the code. */
export const replNotRead = (): Finding =>
  block(
    "role-read-only",
    "REPL runs JavaScript the guard cannot read, and a read-only role never writes. " +
      "Instead, run the read as a Bash command, such as cat or grep, or report what needs changing.",
  );

/** The reads a read-only role allows, named in the block message so a refused role can pick one that works; guard-role-allow.spec.ts checks each is allowed. */
export const WORKING_READS: readonly string[] = [
  "cat",
  "head",
  "tail",
  "ls",
  "grep",
  "rg",
  "wc",
  "sort",
  "diff",
  "tree",
  "jq",
  "stat",
  "file",
  "git log",
  "git status",
  "git show",
  "git diff",
  "git blame",
  "git ls-files",
  "git grep",
  "git rev-parse",
  "gh pr view",
  "gh pr list",
  "gh pr checks",
  "gh pr diff",
  "gh issue view",
  "gh issue list",
  "gh label list",
  "node skills/bin/harness.mjs plan active",
  "node skills/bin/harness.mjs idea list",
  "node skills/bin/harness.mjs idea show",
  "node skills/bin/harness.mjs flow report",
  "node skills/bin/harness.mjs ledger list",
];

const READS_TEXT = WORKING_READS.map((read) => `\`${read}\``).join(", ");

/** A command a read-only role may not run that is not a write: it names the reads that work and never says it changes files. */
export const notRead = (what: string): Finding =>
  block(
    "role-read-only",
    `${what} is refused: a read-only role runs only the reads it allows. Instead, run one of these reads, such as ${READS_TEXT}. ` +
      "If none of them does what you need, report what needs changing: the reader returns it in its summary and the judge sends the change back.",
  );

/** Output redirects and the read-write `<>`, which opens a file for writing without truncating it. */
const FD_OPERATOR = /^(?:\d*>[>|]?|&>>?|\d*<>)$/;
const harmless = (target: string | undefined): boolean =>
  target === "/dev/null" || target === "&1" || target === "&2";

/** The files a segment redirects output to, joined to the operator or following it; /dev/null and another stream are not files. */
export const redirectTargets = (segment: readonly string[]): string[] =>
  segment.flatMap((word, index) => {
    const target = FD_OPERATOR.test(word)
      ? segment[index + 1]
      : /^(?:\d*>[>|]?|&>>?|\d*<>)(.+)$/.exec(word)?.[1];
    return target === undefined || harmless(target) ? [] : [target];
  });

/** The segment without its redirects, which are checked apart from the command's own words. */
export const withoutRedirects = (segment: readonly string[]): string[] =>
  segment.filter(
    (word, index) =>
      !FD_OPERATOR.test(word) &&
      !/^(?:\d*>[>|]?|&>>?|\d*<>)./.test(word) &&
      !FD_OPERATOR.test(segment[index - 1] ?? ""),
  );

const redirectsToFile = (segment: readonly string[]): boolean =>
  redirectTargets(segment).length > 0;

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

/** A segment that sets a variable for a command that follows, or changes shell state: the refusal the read-only roles share. A lone `NAME=value` is no change to a command, and `command -v NAME` runs nothing, so both pass. */
export const setsEnvironment = (segment: readonly string[]): boolean =>
  (PREFIXED.test(segment[0] ?? "") &&
    !bareAssignment(segment) &&
    !commandLookup(segment)) ||
  changesShell(segment);

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

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/;
/** Names a shell or program reads when it runs: a bare assignment to one would steer git, the shell or the harness, so it stays refused. */
const STEERING =
  /^(?:GIT_|PATH$|IFS$|HOME$|XDG_|ENV$|BASH|SHELL|ZDOTDIR$|PAGER$|MANPAGER$|LESS|EDITOR$|VISUAL$|CDPATH$|PROMPT_COMMAND$|PS4$|KORE_|HC_|LD_|DYLD_|NODE_|PERL|PYTHON|RUBY)/;

/** A segment that is one plain `NAME=value` and nothing else: no command follows it, and it is not a steering name. A redirect on it is still a write, which writes() flags. */
export const bareAssignment = (segment: readonly string[]): boolean => {
  const words = withoutRedirects(segment);
  const name = ASSIGNMENT.exec(words[0] ?? "")?.[1];
  return words.length === 1 && name !== undefined && !STEERING.test(name);
};

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
const INTERPRETER = /^(?:node|bash|sh|zsh|dash|ksh)$/;
const HELP_FLAGS = new Set(["--help", "-h"]);

/**
 * Whether a command line runs the bundle (skills/bin/harness.mjs), by an interpreter or by its own path, with exactly three words
 * after the script: a gated pair and one help flag (#973). The caller checks the pair. A program named harness, or another
 * harness.mjs, is not the bundle.
 */
export function bundleHelpRequest(line: readonly string[]): boolean {
  const { name, args } = commandOf(line);
  const interpreted = INTERPRETER.test(name);
  // commandOf keeps only the basename, so the first word as written is read from the line itself.
  const invoked = interpreted
    ? (args[0] ?? "")
    : (line[line.length - args.length - 1] ?? "");
  const words = interpreted ? args.slice(1) : args;
  return (
    HARNESS.test(invoked) &&
    words.length === 3 &&
    HELP_FLAGS.has(words[2] ?? "")
  );
}
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

/**
 * The finish notice every brief ends with, in its one allowed shape:
 * `node skills/bin/harness.mjs session notify <pane> --outcome done|blocked`.
 * The harness builds the line, so a role cannot write its own text into another pane.
 */
export function notifiesFinish(segment: readonly string[]): boolean {
  const { name, args } = commandOf(segment);
  const [path, group, verb, pane, flag, outcome, ...rest] = args;
  return (
    name === "node" &&
    HARNESS.test(path ?? "") &&
    group === "session" &&
    verb === "notify" &&
    /^[\w:]+$/.test(pane ?? "") &&
    flag === "--outcome" &&
    (outcome === "done" || outcome === "blocked") &&
    rest.length === 0
  );
}

/** `herdr pane send-text` or `send-keys`: raw input typed into a pane. */
export function sendsToPane(segment: readonly string[]): boolean {
  const { name, args } = commandOf(segment);
  return (
    name === "herdr" &&
    args[0] === "pane" &&
    (args[1] === "send-text" || args[1] === "send-keys")
  );
}

/** The finding for raw pane input, which names the command a brief's finish notice uses now. */
export const useNotify = (what: string): Finding =>
  block(
    "role-read-only",
    `${what} types into another pane, and a bounded role sends a pane nothing but its finish notice. ` +
      "Instead, run `node skills/bin/harness.mjs session notify <pane> --outcome done|blocked`, which builds the finish line, submits it and confirms it arrived.",
  );

/** The sources (and destination) of `git mv`, `git rm` or `rm [-f]`; any other flag stays a source and is no hook test. */
export function removal(
  line: readonly string[],
): { sources: string[]; destination?: string } | undefined {
  const { name, args } = commandOf(line);
  const [verb = "", ...rest] = args;
  if (name === "rm") {
    return { sources: args.filter((word) => word !== "-f") };
  }
  if (name !== "git" || !["mv", "rm"].includes(verb)) {
    return undefined;
  }
  return verb === "rm"
    ? { sources: rest }
    : { sources: rest.slice(0, -1), destination: rest.at(-1) ?? "-" };
}
