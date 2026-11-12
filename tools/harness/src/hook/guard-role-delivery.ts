// Role bounds for the delivery roles (ADR 0078): the orchestrator and judge change no
// file, only the writer does and only inside its own worktree, and nobody merges until
// the merge tool exists (plan 11 Step 5). The owner approved enforcing these guards on
// #190 and #191 (2026-11-12), so every rule blocks.
import { isAbsolute, relative, resolve } from "node:path";
import {
  harnessAllowed,
  HARNESS,
  PREFIXED,
  readOnly,
  writes,
  WRITE_TOOLS,
} from "./guard-role-writes.js";
import { commandOf, splitSegments } from "./guard-shell.js";
import { block, type Finding } from "./guard-verdict.js";

/** Roles that read and report: they may run the harness and gh/git queries but change no file. */
const REPORTING_ROLES = new Set(["orchestrator", "judge"]);
export const DELIVERY_ROLES = new Set([...REPORTING_ROLES, "writer"]);

const noMerge = (role: string, what: string): Finding =>
  block(
    "role-no-merge",
    `${what} merges, but the ${role} may not: the merge tool does not exist yet (plan 11 Step 5), so no role merges. ` +
      "Instead, report the verdict; the judge reports safe or sends the change back, and the operator merges.",
  );

const outsideWorktree = (what: string, root: string): Finding =>
  block(
    "role-worktree",
    `${what} reaches outside this worktree (${root}), and a writer works only in the worktree it was launched in. ` +
      "Instead, make the change inside the worktree, or report that it needs another piece of work.",
  );

const MERGE_API = /\/pulls\/\d+\/merge\b/;
const merges = (segment: readonly string[]): boolean => {
  const { name, args } = commandOf(segment);
  return (
    name === "gh" &&
    ((args[0] === "pr" && args[1] === "merge") ||
      (args[0] === "api" && args.some((arg) => MERGE_API.test(arg))))
  );
};

/** An interpreter given inline code, or an editor told to work in place, which can write anything. */
function runsInline(segment: readonly string[]): boolean {
  const { name, args } = commandOf(segment);
  return (
    (name === "node" && args.some((a) => ["-e", "--eval", "-p"].includes(a))) ||
    (/^python3?$/.test(name) && args.includes("-c")) ||
    (name === "perl" && args.some((a) => /^-\w*[eEip]/.test(a))) ||
    (name === "ruby" && args.includes("-e")) ||
    (/^g?awk$/.test(name) &&
      args.some((a) => a === "inplace" || a === "--in-place"))
  );
}

/** Reads every role here may run: each prints or checks, and none writes a file. */
const READS = [
  "plan active",
  "idea list",
  "idea show",
  "flow report",
  "ledger list",
  "guardrail status",
  "flag audit",
  "skill audit",
  "session tier",
];
/** The orchestrator also launches and collects panes, and finishes the ideas it drives to an outcome. */
const ORCHESTRATOR_HARNESS = [
  ...READS,
  "session spawn",
  "session wait",
  "session close",
  "session equalize",
  "idea sync",
  "outcome record",
  "outcome close",
];

/** The judge also runs its precheck, which reads GitHub and appends one event to the shared ledger (never a path of its choosing). */
const JUDGE_HARNESS = [...READS, "judge precheck"];

/** The harness commands each delivery role may run; any other role gets the reads. */
const HARNESS_BY_ROLE: Record<string, readonly string[]> = {
  orchestrator: ORCHESTRATOR_HARNESS,
  judge: JUDGE_HARNESS,
};
const harnessFor = (role: string): readonly string[] =>
  HARNESS_BY_ROLE[role] ?? READS;

/** A harness command the role may not run: it writes, or it is not on the role's list. */
function harnessRefused(role: string, segment: readonly string[]): boolean {
  const { name, args } = commandOf(segment);
  if (name !== "node" || !(args[0] ?? "").endsWith("harness.mjs")) {
    return false;
  }
  return !(
    HARNESS.test(args[0] ?? "") && harnessAllowed(name, args, harnessFor(role))
  );
}

const SCRATCH = ["/tmp/", "/private/tmp/", "/var/folders/", "/dev/"];
const PATHS = /(?:~|\.\.|\/)[\w.@~/-]*/g;

/** Whether a path is outside the worktree and not scratch space in tmp. */
function outside(root: string, path: string): boolean {
  if (path.startsWith("~")) {
    return true;
  }
  const full = resolve(root, path);
  const from = relative(root, full);
  const within = from === "" || (!from.startsWith("..") && !isAbsolute(from));
  return (
    !within &&
    !SCRATCH.some((dir) => full.startsWith(dir) || `${full}/` === dir)
  );
}

/** The first path in a writing command, cd or `git -C` that leaves the worktree. */
function escapes(segment: readonly string[], root: string): string | undefined {
  const { name, args } = commandOf(segment);
  const target = name === "git" ? args[args.indexOf("-C") + 1] : args[0];
  if (
    (name === "cd" || (name === "git" && args.includes("-C"))) &&
    target !== undefined &&
    outside(root, target)
  ) {
    return target;
  }
  if (!writes(segment) && !runsInline(segment)) {
    return undefined;
  }
  return segment
    .flatMap((word) => word.replace(/^(?:\d*>>?|&>>?)/, "").match(PATHS) ?? [])
    .find((path) => outside(root, path));
}

export function checkDeliveryBash(
  role: string,
  command: string,
  root: string,
): Finding {
  const segments = splitSegments(command);
  const merging = segments.find(merges);
  if (merging !== undefined) {
    return noMerge(role, `\`${merging.join(" ")}\``);
  }
  if (REPORTING_ROLES.has(role)) {
    // A variable such as KORE_ROOT moves where the harness writes, past its allowlist.
    const prefixed = segments.find((s) => PREFIXED.test(s[0] ?? ""));
    if (prefixed !== undefined) {
      return readOnly(
        `\`${prefixed.join(" ")}\`, which sets an environment variable,`,
      );
    }
    const changing = segments.find(
      (s) => writes(s) || runsInline(s) || harnessRefused(role, s),
    );
    return changing === undefined
      ? null
      : readOnly(`\`${changing.join(" ")}\``);
  }
  for (const segment of segments) {
    const path = escapes(segment, root);
    if (path !== undefined) {
      return outsideWorktree(`\`${segment.join(" ")}\``, root);
    }
  }
  return null;
}

export function checkDelivery(
  role: string,
  tool: string,
  input: Record<string, unknown>,
  root: string,
): Finding {
  if (tool === "Bash" && typeof input["command"] === "string") {
    return checkDeliveryBash(role, input["command"], root);
  }
  if (!WRITE_TOOLS.has(tool)) {
    return null;
  }
  if (REPORTING_ROLES.has(role)) {
    return readOnly(tool);
  }
  const path = input["file_path"] ?? input["notebook_path"];
  return typeof path === "string" && outside(root, path)
    ? outsideWorktree(tool, root)
    : null;
}
