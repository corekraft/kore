// The read-only command allowlist the reader, refiner, judge and orchestrator share:
// read utilities, read-only git and gh verbs, find without its writing actions, and the
// harness commands each role names. Anything not listed here is refused, so a form the
// blocklist never thought of (`awk system()`, `find -exec`, `git -c alias`) cannot write.
import {
  bareAssignment,
  HARNESS,
  harnessAllowed,
} from "./guard-role-writes.js";
import { commandOf } from "./guard-shell.js";

const PR_READS = ["view", "list", "status", "checks"];
const ISSUE_READS = ["view", "list", "status"];

const READ_UTILITIES = new Set([
  "cat",
  "head",
  "tail",
  "ls",
  "grep",
  "rg",
  "wc",
  "cut",
  "paste",
  "tr",
  "uniq",
  "sort",
  "diff",
  "stat",
  "file",
  "tree",
  "basename",
  "dirname",
  "jq",
  "date",
  "echo",
  "pwd",
]);

/** Short-option clusters such as -o and -ro: -o names an output file for sort and tree. */
const hasShortO = (args: readonly string[]): boolean =>
  args.some((arg) => /^-[a-zA-Z]*o/.test(arg));

/** A read utility's options that write a file or run a program. */
function utilityMayRun(name: string, args: readonly string[]): boolean {
  switch (name) {
    case "sort":
      return !(hasShortO(args) || args.some((arg) => /^--(ou|com)/.test(arg)));
    case "tree":
      return !(
        hasShortO(args) ||
        args.some((arg) => arg.startsWith("--ou") || /^-[a-zA-Z]*R/.test(arg))
      );
    case "date":
      return !args.some((arg) => /^-[a-zA-Z]*s|^--s/.test(arg));
    case "rg":
      return !args.some(
        (arg) =>
          arg === "--pre" ||
          arg.startsWith("--pre=") ||
          arg === "--hostname-bin" ||
          arg.startsWith("--hostname-bin="),
      );
    case "file":
      return !args.some(
        (arg) => /^-[a-zA-Z]*C/.test(arg) || arg === "--compile",
      );
    case "uniq": {
      // `uniq [INPUT [OUTPUT]]`: a second positional word names a file to write. A lone `-`
      // is a positional (standard input), and every word after `--` is positional too.
      const end = args.indexOf("--");
      const options = end === -1 ? args : args.slice(0, end);
      const after = end === -1 ? [] : args.slice(end + 1);
      const positional =
        options.filter((arg) => arg === "-" || !arg.startsWith("-")).length +
        after.length;
      return positional <= 1;
    }
    default:
      return true;
  }
}

/** Options that make a read-only `git` verb write a file or run a program. */
const gitWrites = (args: readonly string[]): boolean =>
  args.some(
    // git accepts any unambiguous prefix of a long option, so match prefixes.
    (arg) =>
      /^--(ou|op|ext(-|$)|exec-path|tex|config-env|git-dir|work-tree|namespace)/.test(
        arg,
      ) || arg.startsWith("-O"),
  );

/** The read-only `gh` verbs a bounded role may run; `patches` also allows output that shows code. */
export function ghMayRun(args: readonly string[], patches: boolean): boolean {
  const [group, verb] = args;
  return (
    (group === "issue" && ISSUE_READS.includes(verb ?? "")) ||
    (group === "label" && verb === "list") ||
    (group === "pr" && PR_READS.includes(verb ?? "")) ||
    (patches && group === "pr" && verb === "diff")
  );
}

const READER_GIT = [
  "log",
  "status",
  "show",
  "diff",
  "blame",
  "ls-files",
  "grep",
  "rev-parse",
];

/** `sed -n` with one print or printing substitution and file names only: no `-i`, no `w` or `e` flag, no option after the script (GNU sed reads options after it). */
const SED_PRINT = /^(?:(?:\d+|\$)(?:,(?:\d+|\$))?|\/[^/\n]*\/)?p$/;
const SED_SUBSTITUTE =
  /^s([^\\\n\w\s])(?:\\.|(?!\1)[^\\\n])*\1(?:\\.|(?!\1)[^\\\n])*\1[gp]*$/;
function sedMayRun(args: readonly string[]): boolean {
  const [flag, script, ...files] = args;
  return (
    flag === "-n" &&
    script !== undefined &&
    (SED_PRINT.test(script) || SED_SUBSTITUTE.test(script)) &&
    files.every((file) => !file.startsWith("-"))
  );
}

/** `cd` with at most one path: it changes directory and nothing else. */
const cdMayRun = (args: readonly string[]): boolean =>
  args.length <= 1 && args.every((arg) => !arg.startsWith("-"));

/** awk's program may not run a command, read one, or write a file; options that load a program file or edit in place are refused. */
const AWK_RUNS = /system|getline|[>|]/;
function awkMayRun(args: readonly string[]): boolean {
  let index = 0;
  let arg = args[index] ?? "";
  while (arg.startsWith("-")) {
    if (arg === "-F" || arg === "-v") {
      index += 2;
    } else if (/^-[Fv]./.test(arg)) {
      index += 1;
    } else {
      return false;
    }
    arg = args[index] ?? "";
  }
  const program = args[index];
  return program !== undefined && !AWK_RUNS.test(program);
}

/** `harness hook retro-scan` reads the transcripts and prints counts; a `--ledger` option would name a file to append to. */
const retroScanMayRun = (name: string, args: readonly string[]): boolean =>
  name === "node" &&
  HARNESS.test(args[0] ?? "") &&
  args[1] === "hook" &&
  args[2] === "retro-scan" &&
  !args.some((arg) => arg === "--ledger" || arg.startsWith("--ledger="));

/** What a read-only role's shell may run (the reader, refiner, judge and orchestrator share it): read utilities, queries and allowlisted harness commands; find may not delete, execute or write. */
export function readMayRun(
  segment: readonly string[],
  harness: readonly string[],
): boolean {
  // A lone NAME=value runs no command; a write on the same line is refused by writes(), not here.
  if (bareAssignment(segment)) {
    return true;
  }
  const { name, args } = commandOf(segment);
  if (name === "find") {
    return !args.some((arg) =>
      [
        "-delete",
        "-exec",
        "-execdir",
        "-ok",
        "-okdir",
        "-fprint",
        "-fprint0",
        "-fprintf",
        "-fls",
      ].includes(arg),
    );
  }
  if (name === "git") {
    return (
      READER_GIT.includes(args.find((arg) => !arg.startsWith("-")) ?? "") &&
      !gitWrites(args)
    );
  }
  return (
    harnessAllowed(name, args, harness) ||
    retroScanMayRun(name, args) ||
    (name === "gh" && ghMayRun(args, true)) ||
    (READ_UTILITIES.has(name) && utilityMayRun(name, args)) ||
    (name === "cd" && cdMayRun(args)) ||
    (name === "sed" && sedMayRun(args)) ||
    (name === "awk" && awkMayRun(args))
  );
}
