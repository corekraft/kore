// `harness wait` (ADR 0123): one background wait over pull request checks, pane results and idea
// states (#1033). It takes repeatable --pr <n>, --session <name> and --idea <name> targets, and
// --any-idea, checks each once, and returns on the first to settle, or when the bound passes. It
// reuses `pr checks` (readChecks), `session wait` (settleSessionTarget), and the ledger's idea
// states (readIdeaTarget), so each target reads exactly what its own command reads.
// Docs: docs/guides/contributor.md

import type { CliDeps, Command, CommandContext } from "../runtime/index.js";
import {
  openSessionTarget,
  parseTimeout,
  settleSessionTarget,
  type SessionWaitTarget,
} from "../session/index.js";
import { failed, repoOf } from "./judge-shared.js";
import { readChecks } from "./pr-checks.js";
import { withPause, type Pause } from "./wait-hc-children.js";
import {
  ideaWaits,
  readIdeaTarget,
  type IdeaWaitTarget,
} from "./wait-idea-target.js";

const USAGE_ERROR = 2;
const FAILED = 1;
/** The exit code when the bound passes before any target settles: neither a result nor a failure. */
const BOUND_EXIT = 3;
const MISSING =
  "Missing a target: name one or more with --pr <n>, --session <name>, --idea <name> or --any-idea, such as harness wait --pr 942.";

type Target =
  | { kind: "pr"; target: string; pr: number }
  | { kind: "session"; target: string; session: SessionWaitTarget }
  | { kind: "idea"; target: string; wait: IdeaWaitTarget };

/** One target's read: still pending, settled with its state (and, for an idea, the idea that changed), or a failure to read it. */
type Read =
  | { kind: "pending" }
  | { kind: "settled"; state: string; idea?: string }
  | { kind: "error"; message: string };

/** A refusal before any waiting: its exit code and the message to print. */
interface Refused {
  code: number;
  message: string;
}

/** Where a pull request is read: the checkout root and the repository it belongs to. */
interface Scope {
  root: string;
  repo: string;
}

const PENDING: Read = { kind: "pending" };

/** Prints a refusal to stderr (a JSON error with --json) and returns its exit code. */
function refuse(
  context: CommandContext,
  code: number,
  message: string,
): number {
  const { deps, json } = context;
  deps.stderr(
    json ? `${JSON.stringify({ error: message })}\n` : `${message}\n`,
  );
  return code;
}

/** The pull request targets from --pr, or the refusal naming the first value that is not a number. */
function prTargets(values: readonly string[]): Target[] | Refused {
  const bad = values.find((value) => !/^\d+$/.test(value) || Number(value) < 1);
  if (bad !== undefined) {
    return {
      code: USAGE_ERROR,
      message: `Invalid --pr "${bad}": give a pull request number, such as --pr 942.`,
    };
  }
  return values.map((value) => ({
    kind: "pr",
    target: value,
    pr: Number(value),
  }));
}

/** The session targets from --session, opened and checked for a spawned record; the first that is not is refused. */
async function sessionTargets(
  deps: CliDeps,
  names: readonly string[],
): Promise<Target[] | Refused> {
  const targets: Target[] = [];
  for (const name of names) {
    const opened = await openSessionTarget(deps, name);
    if ("usage" in opened) {
      return { code: USAGE_ERROR, message: opened.usage };
    }
    if ("error" in opened) {
      return { code: FAILED, message: opened.error };
    }
    targets.push({ kind: "session", target: name, session: opened.target });
  }
  return targets;
}

/** The text a target is named by in output: PR #5, session x, idea 0007, or any idea. */
const labelOf = (target: Target): string => {
  if (target.kind === "pr") {
    return `PR #${target.target}`;
  }
  if (target.kind === "session") {
    return `session ${target.target}`;
  }
  return target.wait.idea === undefined
    ? "any idea"
    : `idea ${target.wait.idea}`;
};

/** The flags that name a target again, as the main session restarts the wait with them. */
const flagOf = (target: Target): string => {
  if (target.kind === "pr") {
    return `--pr ${target.target}`;
  }
  if (target.kind === "session") {
    return `--session ${target.target}`;
  }
  return target.wait.idea === undefined
    ? "--any-idea"
    : `--idea ${target.wait.idea}`;
};

/** The flag form of every target in a list, space separated. */
const flagsOf = (targets: readonly Target[]): string =>
  targets.map(flagOf).join(" ");

/** The JSON form of a target: its kind and the value the flag took. */
const refOf = (target: Target) => ({
  kind: target.kind,
  target: target.target,
});

/** The read-only command that shows where a pending target stands, with its exact next step. */
const stepOf = (target: Target): string => {
  if (target.kind === "pr") {
    return `read PR #${target.target} with \`harness pr checks ${target.target}\``;
  }
  if (target.kind === "session") {
    return `read session ${target.target} with \`session wait ${target.target}\``;
  }
  const idea =
    target.wait.idea === undefined ? "" : ` --idea ${target.wait.idea}`;
  return `read the ledger with \`harness ledger list${idea}\``;
};

/** Reads one target once: a PR's checks, a session's pane, or an idea's state changes since the wait began. */
async function readTarget(
  deps: CliDeps,
  target: Target,
  scope: Scope,
  since: string,
): Promise<Read> {
  if (target.kind === "idea") {
    const read = await readIdeaTarget(deps, target.wait, since);
    return read.kind === "pending"
      ? PENDING
      : { kind: "settled", state: read.state, idea: read.idea };
  }
  if (target.kind === "pr") {
    const report = await readChecks(
      deps.runner,
      scope.root,
      scope.repo,
      target.pr,
    );
    return report.state === "pending"
      ? PENDING
      : { kind: "settled", state: report.state };
  }
  const read = await settleSessionTarget(deps, target.session);
  if (read === "pending") {
    return PENDING;
  }
  if ("error" in read) {
    return { kind: "error", message: read.error };
  }
  return { kind: "settled", state: read.outcome };
}

/** The first line a settled target prints: the PR's state, the session's RESULT, or the idea that moved. */
function headOf(
  target: Target,
  settled: { state: string; idea?: string },
): string {
  if (target.kind === "pr") {
    return `settled: PR #${target.target} is ${settled.state}.`;
  }
  if (target.kind === "session") {
    return `settled: session ${target.target} finished: RESULT ${settled.state}.`;
  }
  return `settled: idea ${settled.idea ?? target.target} is now ${settled.state}.`;
}

/** Prints the settled target and its state (an idea's, with the idea that moved), and the targets left to restart with; exits 0. */
function settle(
  context: CommandContext,
  target: Target,
  settled: { state: string; idea?: string },
  rest: readonly Target[],
): number {
  const { deps, json } = context;
  const { state, idea } = settled;
  if (json) {
    deps.stdout(
      `${JSON.stringify({
        outcome: "settled",
        kind: target.kind,
        target: target.target,
        ...(idea === undefined ? {} : { idea }),
        state,
        pending: rest.map(refOf),
      })}\n`,
    );
    return 0;
  }
  const head = headOf(target, settled);
  const restart =
    rest.length === 0
      ? ""
      : `Restart harness wait with the rest: ${flagsOf(rest)}.\n`;
  deps.stdout(`${head}\n${restart}`);
  return 0;
}

/** Prints that the bound passed with nothing settled, naming each pending target and the next step; exits 3. */
function passBound(
  context: CommandContext,
  targets: readonly Target[],
  boundMs: number,
): number {
  const { deps, json } = context;
  const next = `Next: ${targets.map(stepOf).join(" and ")}, then restart harness wait with ${flagsOf(targets)}.`;
  if (json) {
    deps.stdout(
      `${JSON.stringify({ outcome: "bound", pending: targets.map(refOf), next })}\n`,
    );
  } else {
    const labels = targets.map(labelOf).join(", ");
    deps.stdout(
      `harness wait: the bound of ${boundMs / 1000} seconds passed with nothing settled. Still pending: ${labels}. ${next}\n`,
    );
  }
  return BOUND_EXIT;
}

/**
 * Checks every target once per poll, in the order given, and returns on the first to settle.
 * Between polls the pause waits (the checks interval on the injected clock, or the caller's children on hc),
 * and it passes the bound when the next poll would run past it, so the last read is at the bound.
 */
async function poll(
  context: CommandContext,
  targets: readonly Target[],
  scope: Scope,
  boundMs: number,
  pause: Pause,
): Promise<number> {
  const { deps } = context;
  const start = deps.clock.now().getTime();
  const since = new Date(start).toISOString();
  for (;;) {
    for (const target of targets) {
      const read = await readTarget(deps, target, scope, since);
      if (read.kind === "error") {
        return refuse(context, FAILED, read.message);
      }
      if (read.kind === "settled") {
        const rest = targets.filter((other) => other !== target);
        return settle(context, target, read, rest);
      }
    }
    if (await pause(boundMs - (deps.clock.now().getTime() - start))) {
      return passBound(context, targets, boundMs);
    }
  }
}

async function waitRun(context: CommandContext): Promise<number> {
  const { deps, options, lists } = context;
  const {
    pr: prs = [],
    session: names = [],
    idea: ideas = [],
  }: Partial<Record<string, string[]>> = lists ?? {};
  const anyIdea = options["any-idea"] === true;
  if (
    prs.length === 0 &&
    names.length === 0 &&
    ideas.length === 0 &&
    !anyIdea
  ) {
    return refuse(context, USAGE_ERROR, MISSING);
  }
  const timeout = parseTimeout(options["timeout"]);
  if (typeof timeout !== "number") {
    return refuse(context, USAGE_ERROR, timeout.error);
  }
  const pulls = prTargets(prs);
  if (!Array.isArray(pulls)) {
    return refuse(context, pulls.code, pulls.message);
  }
  const waits = ideaWaits(ideas, anyIdea);
  if ("usage" in waits) {
    return refuse(context, USAGE_ERROR, waits.usage);
  }
  const ideaTargets: Target[] = waits.waits.map((wait) => ({
    kind: "idea",
    target: wait.idea ?? "any",
    wait,
  }));
  try {
    const sessions = await sessionTargets(deps, names);
    if (!Array.isArray(sessions)) {
      return refuse(context, sessions.code, sessions.message);
    }
    const scope = { root: await deps.root(), repo: await repoOf(context) };
    const targets = [...pulls, ...sessions, ...ideaTargets];
    return await withPause(
      deps,
      { prs: prs.map(Number), ideas: ideaTargets.length },
      scope,
      (pause: Pause) => poll(context, targets, scope, timeout, pause),
    );
  } catch (error) {
    return failed(context, error);
  }
}

export const harnessWait = {
  summary:
    "wait in the background for the first of pull request checks (--pr <n>), spawned panes' RESULT lines (--session <name>) or an idea's state change in the ledger (--idea <name>, or --any-idea for any idea) to settle, repeating a flag: settled exits 0 and names the target and its state, with the rest to restart with; the bound (--timeout ms, default one hour) exits 3 and names what is still pending and the next step; --json gives the same as one object",
  options: {
    timeout: "string",
    pr: "list",
    session: "list",
    idea: "list",
    "any-idea": "boolean",
  },
  run: waitRun,
} satisfies Omit<Command, "help">;
