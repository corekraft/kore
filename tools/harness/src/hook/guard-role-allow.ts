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
      return !(
        hasShortO(args) ||
        args.some(
          (arg) =>
            arg.startsWith("--output") || arg.startsWith("--compress-program"),
        )
      );
    case "tree":
      return !hasShortO(args);
    case "rg":
      return !args.some((arg) => arg === "--pre" || arg.startsWith("--pre="));
    case "file":
      return !args.some(
        (arg) => /^-[a-zA-Z]*C/.test(arg) || arg === "--compile",
      );
    default:
      return true;
  }
}

/** Options that make a read-only `git` verb write a file or run a program. */
export const gitWrites = (args: readonly string[]): boolean =>
  args.some(
    (arg) =>
      arg.startsWith("--output") ||
      arg.startsWith("--open-files-in-pager") ||
      arg.startsWith("--ext-diff") ||
      arg.startsWith("--textconv") ||
      arg.startsWith("--config-env") ||
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

/** What the reader's shell may run: read utilities, queries and allowlisted harness commands; find may not delete, execute or write. */
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
