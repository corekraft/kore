// `harness wait` (ADR 0123): one background wait over pull request checks and pane results.
// It takes repeatable --pr <n> and --session <name> targets, checks each once, and returns on
// the first to settle, or when the bound passes. It reuses `pr checks` (readChecks) and
// `session wait` (settleSessionTarget), so a session's RESULT is recorded exactly as session
// wait records it. Docs: docs/guides/contributor.md

import type { CliDeps, Command, CommandContext } from "../runtime/index.js";
import {
  openSessionTarget,
  parseTimeout,
  settleSessionTarget,
  type SessionWaitTarget,
} from "../session/index.js";
import { failed, repoOf } from "./judge-shared.js";
import { CHECKS_POLL_MS, readChecks } from "./pr-checks.js";

const USAGE_ERROR = 2;
const FAILED = 1;
/** The exit code when the bound passes before any target settles: neither a result nor a failure. */
const BOUND_EXIT = 3;
const MISSING =
  "Missing a target: name one or more with --pr <n> or --session <name>, such as harness wait --pr 942.";

type Target =
  | { kind: "pr"; target: string; pr: number }
  | { kind: "session"; target: string; session: SessionWaitTarget };

/** One target's read: still pending, settled with its state, or a failure to read it. */
type Read =
  | { kind: "pending" }
  | { kind: "settled"; state: string }
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

/** The text a target is named by in output: PR #5, or session x. */
const labelOf = (target: Target): string =>
  target.kind === "pr" ? `PR #${target.target}` : `session ${target.target}`;

/** The flags that name a target again, as the main session restarts the wait with them. */
const flagOf = (target: Target): string =>
  target.kind === "pr" ? `--pr ${target.target}` : `--session ${target.target}`;

/** The flag form of every target in a list, space separated. */
const flagsOf = (targets: readonly Target[]): string =>
  targets.map(flagOf).join(" ");

/** The JSON form of a target: its kind and the value the flag took. */
const refOf = (target: Target) => ({
  kind: target.kind,
  target: target.target,
});

/** The read-only command that shows where a pending target stands, with its exact next step. */
const stepOf = (target: Target): string =>
  target.kind === "pr"
    ? `read PR #${target.target} with \`harness pr checks ${target.target}\``
    : `read session ${target.target} with \`session wait ${target.target}\``;

/** Reads one target once: a PR's checks, or a session's pane. */
async function readTarget(
  deps: CliDeps,
  target: Target,
  scope: Scope,
): Promise<Read> {
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

/** Prints the settled target and its state, and the targets left to restart with; exits 0. */
function settle(
  context: CommandContext,
  target: Target,
  state: string,
  rest: readonly Target[],
): number {
  const { deps, json } = context;
  if (json) {
    deps.stdout(
      `${JSON.stringify({
        outcome: "settled",
        kind: target.kind,
        target: target.target,
        state,
        pending: rest.map(refOf),
      })}\n`,
    );
    return 0;
  }
  const head =
    target.kind === "pr"
      ? `settled: PR #${target.target} is ${state}.`
      : `settled: session ${target.target} finished: RESULT ${state}.`;
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
 * Between polls it sleeps the pr checks interval on the injected clock, and it passes the
 * bound when the next poll would run past it, so the last read is at the bound.
 */
async function poll(
  context: CommandContext,
  targets: readonly Target[],
  scope: Scope,
  boundMs: number,
): Promise<number> {
  const { deps } = context;
  const start = deps.clock.now().getTime();
  for (;;) {
    for (const target of targets) {
      const read = await readTarget(deps, target, scope);
      if (read.kind === "error") {
        return refuse(context, FAILED, read.message);
      }
      if (read.kind === "settled") {
        const rest = targets.filter((other) => other !== target);
        return settle(context, target, read.state, rest);
      }
    }
    if (deps.clock.now().getTime() - start + CHECKS_POLL_MS > boundMs) {
      return passBound(context, targets, boundMs);
    }
    await deps.clock.sleep(CHECKS_POLL_MS);
  }
}

async function waitRun(context: CommandContext): Promise<number> {
  const { deps, options, lists } = context;
  const prs = lists?.["pr"] ?? [];
  const names = lists?.["session"] ?? [];
  if (prs.length === 0 && names.length === 0) {
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
  try {
    const sessions = await sessionTargets(deps, names);
    if (!Array.isArray(sessions)) {
      return refuse(context, sessions.code, sessions.message);
    }
    const scope = { root: await deps.root(), repo: await repoOf(context) };
    return await poll(context, [...pulls, ...sessions], scope, timeout);
  } catch (error) {
    return failed(context, error);
  }
}

export const harnessWait: Command = {
  summary:
    "wait in the background for the first of pull request checks (--pr <n>) or spawned panes' RESULT lines (--session <name>) to settle, repeating either flag: settled exits 0 and names the target and its state, with the rest to restart with; the bound (--timeout ms, default one hour) exits 3 and names what is still pending and the next step; --json gives the same as one object",
  options: { timeout: "string", pr: "list", session: "list" },
  run: waitRun,
};
