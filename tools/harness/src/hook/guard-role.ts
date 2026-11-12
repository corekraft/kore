// Role bounds for the delivery loop's read-only agents (ADR 0078). Panes run in
// bypass mode, so these guard rules, not permission prompts, keep the
// concierge and the reader from writing files, and the concierge from reading
// code. The delivery roles are bounded in guard-role-delivery.ts. The host names the role as `agent_type` when a session starts with
// `claude --agent <role>`; a session without one is not bounded here.
//
// These rules enforce from the start, not in audit mode: the owner approved
// enforcing the plan 11 role guards on 2026-11-12, which ADR 0080 requires a
// person to do. A new capability for a role needs a guard case first.
import { isAbsolute, relative, resolve } from "node:path";
import { ghMayRun, readMayRun } from "./guard-role-allow.js";
import { checkDelivery, DELIVERY_ROLES } from "./guard-role-delivery.js";
import {
  changesShell,
  harnessAllowed,
  harnessStatus,
  readOnly,
  writes,
  WRITE_TOOLS,
} from "./guard-role-writes.js";
import { commandOf, splitSegments } from "./guard-shell.js";
import { block, type Finding } from "./guard-verdict.js";

const READ_ONLY_ROLES = new Set([
  "concierge",
  "reader",
  "refiner",
  "challenger",
]);
/** Roles that answer from plans, ADRs, ideas and issues and never read code. */
const NO_CODE_ROLES = new Set(["concierge", "challenger"]);
const FILE_TOOLS = new Set(["Read", "Grep", "Glob"]);

/** Paths the concierge and the challenger may read: plans, ADRs and ideas, never code. */
const CONCIERGE_PATHS = /^(infra\/plans\/|docs\/|GLOSSARY\.md$|README\.md$)/;

/** The path relative to the repository with `..` resolved, or undefined when it leaves the repository. */
function insideRoot(root: string, path: string): string | undefined {
  const from = relative(root, resolve(root, path));
  return from.startsWith("..") || isAbsolute(from) ? undefined : from;
}

/** Whether a file tool call stays in the folders a no-code role may read; a glob pattern may not climb or be absolute. */
function readable(root: string, input: Record<string, unknown>): boolean {
  const path = input["file_path"] ?? input["path"];
  const pattern = input["pattern"];
  const glob = input["glob"];
  const climbs = [pattern, glob].some(
    (value) =>
      typeof value === "string" &&
      (value.split("/").includes("..") || value.startsWith("/")),
  );
  const inside = typeof path === "string" ? insideRoot(root, path) : undefined;
  return !climbs && inside !== undefined && CONCIERGE_PATHS.test(inside);
}

const noCode = (what: string, role: string): Finding =>
  block(
    "role-no-code",
    `${what} reads code, and the ${role} works from plans, ADRs, ideas, issues and the ledger. ` +
      "Instead, ask a reader to look at the code and summarize it.",
  );

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
/** The challenger records its rounds through the idea tool, which posts them on the issue. */
/** The refiner files and mirrors the idea it refined, the one thing it produces. */
const REFINER_HARNESS = [...HARNESS_READS, "idea new", "idea sync"];
const CHALLENGER_HARNESS = [...HARNESS_READS, "idea challenge"];

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

/** What a no-code role's shell may run: its allowlisted harness commands and status queries, never anything that shows code. */
function noCodeMayRun(role: string, segment: readonly string[]): boolean {
  const { name, args } = commandOf(segment);
  return (
    harnessAllowed(
      name,
      args,
      role === "challenger" ? CHALLENGER_HARNESS : CONCIERGE_HARNESS,
    ) ||
    harnessStatus(name, args) ||
    (name === "gh" && ghMayRun(args, false)) ||
    (name === "git" && conciergeGit(args)) ||
    ["date", "echo", "pwd"].includes(name)
  );
}

/** A segment that starts with `VAR=value` or an `env`-style wrapper: git and the harness read variables such as GIT_EXTERNAL_DIFF, PAGER and KORE_ROOT to run a program or move the ledger. */
const PREFIXED =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=|(?:sudo|env|time|command|nohup|exec)$)/;

function checkBash(role: string, command: string): Finding {
  // A substitution runs a command the segment check never sees.
  if (/\$\(|`|<\(|>\(/.test(command)) {
    return NO_CODE_ROLES.has(role)
      ? noCode("A command substitution", role)
      : readOnly("A command substitution");
  }
  const segments = splitSegments(command);
  const prefixed = segments.find(
    (segment) => PREFIXED.test(segment[0] ?? "") || changesShell(segment),
  );
  if (prefixed !== undefined) {
    const what = `\`${prefixed.join(" ")}\`, which sets an environment variable or changes shell state,`;
    return NO_CODE_ROLES.has(role) ? noCode(what, role) : readOnly(what);
  }
  const writer = segments.find(writes);
  if (writer !== undefined) {
    return readOnly(`\`${writer.join(" ")}\``);
  }
  if (NO_CODE_ROLES.has(role)) {
    const stray = segments.find((segment) => !noCodeMayRun(role, segment));
    return stray === undefined ? null : noCode(`\`${stray.join(" ")}\``, role);
  }
  const unknown = segments.find(
    (segment) =>
      !readMayRun(
        segment,
        role === "refiner" ? REFINER_HARNESS : HARNESS_READS,
      ),
  );
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
  if (typeof agentType === "string" && DELIVERY_ROLES.has(agentType)) {
    return checkDelivery(agentType, tool, input, root);
  }
  if (typeof agentType !== "string" || !READ_ONLY_ROLES.has(agentType)) {
    return null;
  }
  if (WRITE_TOOLS.has(tool)) {
    return readOnly(`${tool}`);
  }
  if (tool === "Bash" && typeof input["command"] === "string") {
    return checkBash(agentType, input["command"]);
  }
  if (NO_CODE_ROLES.has(agentType) && FILE_TOOLS.has(tool)) {
    return readable(root, input) ? null : noCode(tool, agentType);
  }
  return null;
}
