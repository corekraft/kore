// Role bounds for the delivery loop's read-only agents (ADR 0078). Panes run in
// bypass mode, so these guard rules, not permission prompts, keep the
// concierge and the reader from writing files, and the concierge from reading
// code. The host names the role as `agent_type` when a session starts with
// `claude --agent <role>`; a session without one is not bounded here.
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
const READ_UTILITIES = new Set([
  "cat",
  "head",
  "tail",
  "ls",
  "grep",
  "rg",
  "wc",
  "sort",
  "uniq",
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
  "sed",
]);

/** The command is the harness, run from the repository's own bundle. */
const isHarness = (name: string, args: readonly string[]): boolean =>
  name === "node" && HARNESS.test(args[0] ?? "");

/** The read-only `gh` and `git` verbs a bounded role may run; `patches` also allows output that shows code. */
function mayQuery(
  name: string,
  args: readonly string[],
  patches: boolean,
): boolean {
  if (name === "gh") {
    const [group, verb] = args;
    return (
      (group === "issue" && ISSUE_READS.includes(verb ?? "")) ||
      (group === "label" && verb === "list") ||
      (group === "pr" && PR_READS.includes(verb ?? "")) ||
      (patches && group === "pr" && verb === "diff")
    );
  }
  const verb = args.find((arg) => !arg.startsWith("-"));
  const shows = args.some((arg) =>
    /^(-p|-u|--patch|--stat|--cc|-c)$/.test(arg),
  );
  const verbs = patches
    ? [
        "log",
        "status",
        "show",
        "diff",
        "blame",
        "ls-files",
        "grep",
        "rev-parse",
      ]
    : ["log", "status"];
  return name === "git" && verbs.includes(verb ?? "") && (patches || !shows);
}

/** What the concierge's shell may run: the harness and status queries, never anything that shows code. */
function conciergeMayRun(segment: readonly string[]): boolean {
  const { name, args } = commandOf(segment);
  return (
    isHarness(name, args) ||
    mayQuery(name, args, false) ||
    ["date", "echo", "pwd"].includes(name)
  );
}

/** What the reader's shell may run: read utilities, queries and the harness; find may not delete or execute. */
function readerMayRun(segment: readonly string[]): boolean {
  const { name, args } = commandOf(segment);
  if (name === "find") {
    return !args.some((arg) =>
      ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint"].includes(
        arg,
      ),
    );
  }
  return (
    isHarness(name, args) ||
    READ_UTILITIES.has(name) ||
    mayQuery(name, args, true)
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
