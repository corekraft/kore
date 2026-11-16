// Role bounds for the delivery roles (ADR 0078): the judge changes no
// file, only the writer does and only inside its own worktree, and the only merge is the
// judge's `harness judge merge`, which re-runs the precheck first (plan 11 Step 5). A
// session with no role, such as the person's, is not bound here and keeps `gh pr merge`.
// The judge runs under the shared read allowlist in guard-role-allow.ts,
// so a write form nobody listed is refused by default. The owner approved enforcing these
// guards on #190 and #191 (2026-11-12), so every rule blocks.
// The writer's worktree bound (role-worktree) lives in guard-role-worktree.ts.
import {
  harnessAllowed,
  notifiesFinish,
  notRead,
  sendsToPane,
  setsEnvironment,
  useNotify,
  SUBSTITUTION,
  wrapsCommands,
  HARNESS,
  readOnly,
  writes,
  WRITE_TOOLS,
} from "./guard-role-writes.js";
import { readMayRun } from "./guard-role-allow.js";
import {
  mergesPr,
  runsJudgeTool,
  withSubstitutions,
} from "./guard-role-merge.js";
import { pushesByTracking, pushesToMain } from "./guard-role-push.js";
import { takesRoute, takesWriterRoute } from "./guard-role-routes.js";
import { commandOf, splitSegments } from "./guard-shell.js";
import {
  leavingWorktree,
  outside,
  outsideWorktree,
  runsInline,
} from "./guard-role-worktree.js";
import { block, type Finding } from "./guard-verdict.js";

export { runsInline };

const noMerge = (role: string, what: string): Finding =>
  block(
    "role-no-merge",
    `${what} merges, approves or pushes to main, but the ${role} may not do that by hand: the merge tool re-runs the precheck and merges only when it passes. ` +
      "Instead, the judge approves with `harness judge approve <pr>`, then `harness judge merge <pr>`, or `harness judge send-back <pr> --reason <why> --category <category>`; every other role reports and leaves the merge to the judge.",
  );

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
/**
 * The judge also runs its precheck, which reads GitHub and appends one event to the
 * shared ledger, `judge diff`, which only reads a PR's diff, and the approve, merge and send-back tools, which write only through gh and that
 * same ledger (never a path of its choosing).
 */
const JUDGE_HARNESS = [
  ...READS,
  "judge precheck",
  "judge diff",
  "judge approve",
  "judge merge",
  "judge send-back",
  "session notify",
];

/** The harness commands each delivery role may run; any other role gets the reads. */
const HARNESS_BY_ROLE: Record<string, readonly string[]> = {
  judge: JUDGE_HARNESS,
};
const harnessFor = (role: string): readonly string[] =>
  HARNESS_BY_ROLE[role] ?? READS;

/** What a reporting role's shell may run: the shared read allowlist with the role's harness commands. Anything else is refused. */
function reportingMayRun(role: string, segment: readonly string[]): boolean {
  return readMayRun(segment, harnessFor(role));
}

/** A harness command the role may not run: it writes, or it is not on the role's list. */
function harnessRefused(role: string, segment: readonly string[]): boolean {
  const { name, args } = commandOf(segment);
  if (name !== "node" || !(args[0] ?? "").endsWith("harness.mjs")) {
    return false;
  }
  if (args[1] === "session" && args[2] === "notify") {
    return !notifiesFinish(segment);
  }
  return !(
    HARNESS.test(args[0] ?? "") && harnessAllowed(name, args, harnessFor(role))
  );
}

/** The finding for a segment a reporting role may not run: raw pane input is pointed at `session notify`. */
function refused(segment: readonly string[]): Finding {
  const what = `\`${segment.join(" ")}\``;
  if (sendsToPane(segment)) {
    return useNotify(what);
  }
  return writes(segment) ? readOnly(what) : notRead(what);
}

/** `reporting` is the role's kind from the registry: a reporting role reads and never changes a file. */
export function checkDeliveryBash(
  role: string,
  reporting: boolean,
  command: string,
  root: string,
  cwd: string = root,
): Finding {
  const segments = splitSegments(command);
  // A command substituted into another still runs, so the merge checks read it too.
  const merging = withSubstitutions(command).find(
    (s) =>
      mergesPr(s) ||
      pushesToMain(s) ||
      takesRoute(s) ||
      // Only the writer has the full shell; the read-only roles' allowlist refuses these anyway.
      (!reporting && takesWriterRoute(s)) ||
      // A reporting role never pushes at all (read-only below), so only the writer needs the branch read.
      (!reporting && pushesByTracking(s, root)),
  );
  if (merging !== undefined) {
    return noMerge(role, `\`${merging.join(" ")}\``);
  }
  const judging = segments.find((s) => runsJudgeTool(s, HARNESS));
  if (judging !== undefined && role !== "judge") {
    return noMerge(role, `\`${judging.join(" ")}\``);
  }
  if (reporting) {
    if (SUBSTITUTION.test(command)) {
      return notRead("A command or process substitution");
    }
    const wrapping = segments.find(wrapsCommands);
    if (wrapping !== undefined) {
      return notRead(
        `\`${wrapping.join(" ")}\`, which wraps or launches other commands,`,
      );
    }
    // A variable such as KORE_ROOT moves where the harness writes, past its allowlist.
    const prefixed = segments.find(setsEnvironment);
    if (prefixed !== undefined) {
      return notRead(
        `\`${prefixed.join(" ")}\`, which sets an environment variable or changes shell state,`,
      );
    }
    const changing = segments.find(
      (s) =>
        writes(s) ||
        runsInline(s) ||
        harnessRefused(role, s) ||
        !reportingMayRun(role, s),
    );
    return changing === undefined ? null : refused(changing);
  }
  return leavingWorktree(command, root, cwd);
}

/** Where a tool call runs: the worktree root and the directory the hook ran in. */
export interface Place {
  readonly root: string;
  readonly cwd: string;
}

/** `reporting` is the role's kind from the registry (see checkDeliveryBash). */
export function checkDelivery(
  role: string,
  reporting: boolean,
  tool: string,
  input: Record<string, unknown>,
  { root, cwd }: Place,
): Finding {
  if (tool === "Bash" && typeof input["command"] === "string") {
    return checkDeliveryBash(role, reporting, input["command"], root, cwd);
  }
  if (!WRITE_TOOLS.has(tool)) {
    return null;
  }
  if (reporting) {
    return readOnly(tool);
  }
  const path = input["file_path"] ?? input["notebook_path"];
  return typeof path === "string" && outside(root, path)
    ? outsideWorktree(tool, root)
    : null;
}
