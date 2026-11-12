// Role bounds for the delivery loop's read-only agents (ADR 0078). Panes run in
// bypass mode, so these guard rules, not permission prompts, keep the
// concierge and the reader from writing files, and the concierge from reading
// code. The host names the role as `agent_type` when a session starts with
// `claude --agent <role>`; a session without one is not bounded here.
//
// These rules enforce from the start, not in audit mode: the owner approved
// enforcing the plan 11 role guards on 2026-11-12, which ADR 0080 requires a
// person to do. A new capability for a role needs a guard case first.
import { commandOf, splitSegments } from "./guard-shell.js";
import { block, type Finding } from "./guard-verdict.js";

const READ_ONLY_ROLES = new Set(["concierge", "reader"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
const FILE_TOOLS = new Set(["Read", "Grep", "Glob"]);

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

/** Paths the concierge may read: what status is answered from, never code. */
const CONCIERGE_PATHS = /^(infra\/plans\/|docs\/|GLOSSARY\.md$|README\.md$)/;

const rolePrefix = (root: string, path: string): string =>
  path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;

const readOnly = (what: string): Finding =>
  block(
    "role-read-only",
    `${what} changes files, and the concierge and reader never write. ` +
      "Instead, report what needs changing: the concierge files it as an idea, the reader returns it in its summary.",
  );

const noCode = (what: string): Finding =>
  block(
    "role-no-code",
    `${what} reads code, and the concierge answers from plans, issues and the ledger. ` +
      "Instead, ask a reader to look at the code and summarize it.",
  );

const FD_OPERATOR = /^(?:\d*>>?|&>>?)$/;
const harmless = (target: string | undefined): boolean =>
  target === "/dev/null" || target === "&1" || target === "&2";

/** Whether a word redirects output somewhere other than /dev/null or another stream, joined to its target or followed by it. */
const redirectsToFile = (segment: readonly string[]): boolean =>
  segment.some((word, index) => {
    if (FD_OPERATOR.test(word)) {
      return !harmless(segment[index + 1]);
    }
    const joined = /^(?:\d*>>?|&>>?)(.+)$/.exec(word);
    return joined !== null && !harmless(joined[1]);
  });

/** Whether a command writes: a writer, `sed -i`, writing git or gh verbs, or a redirect to a file. */
function writes(segment: readonly string[]): boolean {
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

const HARNESS = /^(\.\/)?skills\/bin\/harness\.mjs$/;
const PR_READS = ["view", "list", "status", "checks"];
const ISSUE_READS = ["view", "list", "status"];

/** The harness commands both roles may run; each is read-only. */
const HARNESS_READS = [
  "plan active",
  "idea list",
  "idea show",
  "flow report",
  "ledger list",
];
/** The concierge also files and mirrors ideas, the one way a request enters the queue. */
const CONCIERGE_HARNESS = [...HARNESS_READS, "idea new", "idea sync"];

/** The command is the harness bundle and its `<domain> <command>` is on the role's list; anything else, even a prefix match, is not. */
const harnessAllowed = (
  name: string,
  args: readonly string[],
  allowed: readonly string[],
): boolean =>
  name === "node" &&
  HARNESS.test(args[0] ?? "") &&
  allowed.includes(`${args[1] ?? ""} ${args[2] ?? ""}`);

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
const gitWrites = (args: readonly string[]): boolean =>
  args.some(
    (arg) =>
      arg.startsWith("--output") ||
      arg.startsWith("--open-files-in-pager") ||
      arg.startsWith("-O"),
  );

/** The only options the concierge's `git log` and `git status` take: none prints changed lines. */
const CONCIERGE_GIT_FLAGS: Record<string, RegExp> = {
  log: /^(--|--oneline|--graph|--decorate|--no-decorate|--all|--no-merges|--merges|--first-parent|--abbrev-commit|--since=.+|--until=.+|--author=.+|--grep=.+|--format=.+|--pretty=.+|--date=.+|--max-count=.+|-n|-\d+)$/,
  status: /^(-s|--short|-b|--branch|--porcelain|--porcelain=.+|--long)$/,
};

function conciergeGit(args: readonly string[]): boolean {
  const [verb = "", ...rest] = args;
  const flags = CONCIERGE_GIT_FLAGS[verb];
  return (
    flags !== undefined &&
    rest.every((arg) => !arg.startsWith("-") || flags.test(arg))
  );
}

/** The read-only `gh` verbs a bounded role may run; `patches` also allows output that shows code. */
function ghMayRun(args: readonly string[], patches: boolean): boolean {
  const [group, verb] = args;
  return (
    (group === "issue" && ISSUE_READS.includes(verb ?? "")) ||
    (group === "label" && verb === "list") ||
    (group === "pr" && PR_READS.includes(verb ?? "")) ||
    (patches && group === "pr" && verb === "diff")
  );
}

/** What the concierge's shell may run: allowlisted harness commands and status queries, never anything that shows code. */
function conciergeMayRun(segment: readonly string[]): boolean {
  const { name, args } = commandOf(segment);
  return (
    harnessAllowed(name, args, CONCIERGE_HARNESS) ||
    (name === "gh" && ghMayRun(args, false)) ||
    (name === "git" && conciergeGit(args)) ||
    ["date", "echo", "pwd"].includes(name)
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
function readerMayRun(segment: readonly string[]): boolean {
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
    harnessAllowed(name, args, HARNESS_READS) ||
    (name === "gh" && ghMayRun(args, true)) ||
    (READ_UTILITIES.has(name) && utilityMayRun(name, args))
  );
}

function checkBash(role: string, command: string): Finding {
  // A substitution runs a command the segment check never sees.
  if (/\$\(|`|<\(|>\(/.test(command)) {
    return role === "concierge"
      ? noCode("A command substitution")
      : readOnly("A command substitution");
  }
  const segments = splitSegments(command);
  const writer = segments.find(writes);
  if (writer !== undefined) {
    return readOnly(`\`${writer.join(" ")}\``);
  }
  if (role === "concierge") {
    const stray = segments.find((segment) => !conciergeMayRun(segment));
    return stray === undefined ? null : noCode(`\`${stray.join(" ")}\``);
  }
  const unknown = segments.find((segment) => !readerMayRun(segment));
  return unknown === undefined
    ? null
    : readOnly(
        `\`${unknown.join(" ")}\`, which is not a known read-only command,`,
      );
}

/** The role bounds for one tool call; null when the session has no bounded role or the call is within it. */
export function checkRole(
  agentType: unknown,
  tool: string,
  input: Record<string, unknown>,
  root: string,
): Finding {
  if (typeof agentType !== "string" || !READ_ONLY_ROLES.has(agentType)) {
    return null;
  }
  if (WRITE_TOOLS.has(tool)) {
    return readOnly(`${tool}`);
  }
  if (tool === "Bash" && typeof input["command"] === "string") {
    return checkBash(agentType, input["command"]);
  }
  if (agentType === "concierge" && FILE_TOOLS.has(tool)) {
    const path = input["file_path"] ?? input["path"];
    const readable =
      typeof path === "string" && CONCIERGE_PATHS.test(rolePrefix(root, path));
    return readable ? null : noCode(tool);
  }
  return null;
}
