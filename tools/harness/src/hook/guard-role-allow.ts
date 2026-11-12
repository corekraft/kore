// The read-only command allowlist the reader, refiner, judge and orchestrator share:
// read utilities, read-only git and gh verbs, find without its writing actions, and the
// harness commands each role names. Anything not listed here is refused, so a form the
// blocklist never thought of (`awk system()`, `find -exec`, `git -c alias`) cannot write.
import { harnessAllowed } from "./guard-role-writes.js";
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
      return !(hasShortO(args) || args.some((arg) => arg.startsWith("--ou")));
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
    default:
      return true;
  }
}

/** Options that make a read-only `git` verb write a file or run a program. */
const gitWrites = (args: readonly string[]): boolean =>
  args.some(
    // git accepts any unambiguous prefix of a long option, so match prefixes.
    (arg) =>
      /^--(ou|op|ex|tex|con|git-dir|work-tree|namespace)/.test(arg) ||
      arg.startsWith("-O"),
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

/** What a read-only role's shell may run (the reader, refiner, judge and orchestrator share it): read utilities, queries and allowlisted harness commands; find may not delete, execute or write. */
export function readMayRun(
  segment: readonly string[],
  harness: readonly string[],
): boolean {
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
    (name === "gh" && ghMayRun(args, true)) ||
    (READ_UTILITIES.has(name) && utilityMayRun(name, args))
  );
}
