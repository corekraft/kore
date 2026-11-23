// SessionStart hook. After compaction it restates the AGENTS.md rules and the
// active plans' open items, since compaction may drop them. On a fresh session
// or /clear it prints a short brief: where each active plan stands, its Next:
// line and upcoming steps, the last operation per environment, and whether a
// retrospective is due. A writer, judge, reader or principles-review session
// gets no plan lines (idea 0014). The plans are read by the shared plan parser,
// so the brief, `plan active` and the handoff cannot disagree.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { FlagError } from "../flag/index.js";
import {
  activePlans,
  listItems,
  nextStep,
  openCounts,
  openItems,
  upcomingSteps,
} from "../plan/index.js";
import { GUARD_ROLES } from "./guard-roles.js";
import { lastRetrospective, MarkerError, PLANS_DIR } from "./retro-scan.js";

const RETRO_AFTER_SESSIONS = 5;

/**
 * The line the main session gets while pane-result-summary is on: where a
 * finished session's summary is read instead of its terminal (ADR 0123).
 */
export const RESULT_SUMMARY_LINE =
  "A finished session's result summary is read with `harness session wait <name>`, not a read of its terminal; see `harness session wait --help` for how to print it.";

/**
 * The line the main session gets while main-session-wait is on: one background
 * `harness wait` over pull requests and sessions, in place of sleep, until and seq
 * loops (ADR 0123).
 */
export const MAIN_SESSION_WAIT_LINE =
  "Wait for CI or a session's result with `harness harness wait` in the background, not with sleep, until or seq loops: it returns when the first settles; see `harness harness wait --help` for its flags.";

/**
 * The line the main session gets while signed-main-sends is on: `session send`
 * in place of a raw hc send (ADR 0123).
 */
export const SIGNED_SEND_LINE =
  "Message a session with `harness session send <name>`, not a raw hc send: it confirms delivery and records the event; see `harness session send --help` for its flags.";

/**
 * The roles that get no plan session brief: their orchestrator-only steps are
 * not theirs (idea 0014). Every other agent type, and a missing one, gets it.
 */
const NO_PLAN_BRIEF = new Set<string>(GUARD_ROLES);

/** One line of an operation journal; only the fields the brief reads. */
export interface JournalEntry {
  kind?: unknown;
  op?: unknown;
  command?: unknown;
  ts?: unknown;
  outcome?: unknown;
  error?: unknown;
}

/** What the brief reads, so a spec can supply it without a repository. */
export interface ContextDeps {
  readAgents(): Promise<string>;
  readPlans(): Promise<Record<string, string>>;
  readJournals(): Promise<Record<string, JournalEntry[]>>;
  /** Transcripts newer than the marker date, leaving out the current session's own. */
  sessionsSince(
    date: string | null,
    current: string | undefined,
  ): Promise<number>;
  /** Whether the local overlay turns pane-result-summary on; a malformed overlay throws a FlagError. */
  paneResultSummaryOn(): Promise<boolean>;
  /** Whether the local overlay turns signed-main-sends on; a malformed overlay throws a FlagError. */
  signedMainSendsOn(): Promise<boolean>;
  /** Whether the local overlay turns main-session-wait on; a malformed overlay throws a FlagError. */
  mainSessionWaitOn(): Promise<boolean>;
}

export interface SessionEvent {
  source?: unknown;
  session_id?: unknown;
  /** The role a session was started with by `claude --agent <role>`, when it was. */
  agent_type?: unknown;
}

/** Every AGENTS.md rule, with its enforcement markers kept. */
export function rules(agentsMarkdown: string): string[] {
  return listItems(agentsMarkdown).map((item) => item.text);
}

interface Operation {
  command: unknown;
  ts: unknown;
  /** Null when the operation was interrupted. */
  outcome: unknown;
  error: unknown;
}

/** The latest operation in a journal, or null when it holds no start. */
function lastOperation(entries: readonly JournalEntry[]): Operation | null {
  const start = entries.findLast((entry) => entry.kind === "start");
  if (!start) {
    return null;
  }
  const end = entries.findLast(
    (entry) => entry.kind === "end" && entry.op === start.op,
  );
  return {
    command: start.command,
    ts: start.ts,
    outcome: end?.outcome ?? null,
    error: end?.error,
  };
}

/** A journal field as text; a value that is not a string or number is written as JSON. */
const show = (value: unknown): string =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : (JSON.stringify(value) ?? "");

/** One line per environment journal: the last operation, its outcome, and its date. */
function environmentLines(
  journals: Readonly<Record<string, readonly JournalEntry[]>>,
): string[] {
  const lines: string[] = [];
  for (const environment of Object.keys(journals).sort()) {
    const last = lastOperation(journals[environment] ?? []);
    if (!last) {
      continue;
    }
    const date = show(last.ts).slice(0, 10);
    const label = `Environment ${environment}: last operation \`${show(last.command)}\``;
    if (last.outcome === null) {
      lines.push(
        `${label} was interrupted (started ${date}, no end recorded).`,
      );
    } else if (last.outcome === "failed") {
      const reason = last.error ? `: ${show(last.error)}` : "";
      lines.push(`${label} failed on ${date}${reason}.`);
    } else {
      lines.push(`${label} ${show(last.outcome)} on ${date}.`);
    }
  }
  return lines;
}

/** Whether the session gets the plan session brief: every session but a guard role's. */
function givesPlanBrief(event: SessionEvent): boolean {
  return (
    typeof event.agent_type !== "string" || !NO_PLAN_BRIEF.has(event.agent_type)
  );
}

/**
 * Whether the session has no role. Every role terminal is started with `--agent`
 * (session exec), so the main session is the one that has none.
 */
function isMainSession(event: SessionEvent): boolean {
  return typeof event.agent_type !== "string" || event.agent_type === "";
}

/**
 * The line for the main session while its flag is on. A flag that cannot be
 * read becomes a warning in its place, so the rest of the brief stays.
 */
async function mainSessionLines(
  event: SessionEvent,
  flagOn: () => Promise<boolean>,
  line: string,
): Promise<string[]> {
  if (!isMainSession(event)) {
    return [];
  }
  try {
    return (await flagOn()) ? [line] : [];
  } catch (error) {
    if (error instanceof FlagError) {
      return [`Warning: ${error.message}`];
    }
    throw error;
  }
}

/** Each active plan's open items, Next: line and upcoming steps. */
function planLines(plans: Readonly<Record<string, string>>): string[] {
  const lines: string[] = [];
  for (const plan of activePlans(plans)) {
    const markdown = plans[plan] ?? "";
    lines.push(`Session brief from ${PLANS_DIR}/${plan}:`);
    const counts = openCounts(markdown)
      .map(({ step, count }) => `${step} (${count})`)
      .join(", ");
    if (counts) {
      lines.push(`Open items: ${counts}.`);
    }
    const next = nextStep(markdown);
    if (next) {
      lines.push(`Next (${next.step}): ${next.text}`);
    }
    const upcoming = upcomingSteps(markdown);
    if (upcoming.length > 0) {
      lines.push(`Upcoming: ${upcoming.join("; ")}.`);
    }
  }
  return lines;
}

/** A few lines for a fresh session: active plans, Next: lines, upcoming steps, environments, retrospective due. */
export async function brief(
  event: SessionEvent,
  deps: ContextDeps,
): Promise<string> {
  const plans = await deps.readPlans();
  const lines: string[] = givesPlanBrief(event) ? planLines(plans) : [];
  lines.push(
    ...(await mainSessionLines(
      event,
      () => deps.paneResultSummaryOn(),
      RESULT_SUMMARY_LINE,
    )),
  );
  lines.push(
    ...(await mainSessionLines(
      event,
      () => deps.signedMainSendsOn(),
      SIGNED_SEND_LINE,
    )),
  );
  lines.push(
    ...(await mainSessionLines(
      event,
      () => deps.mainSessionWaitOn(),
      MAIN_SESSION_WAIT_LINE,
    )),
  );
  lines.push(...environmentLines(await deps.readJournals()));
  const reminder = await retroLine(event, plans, deps);
  if (reminder !== null) {
    lines.push(reminder);
  }
  return lines.join("\n");
}

/**
 * The retrospective reminder, once enough sessions have passed, or null. A
 * marker the plan's author must fix becomes a warning in its place, so it
 * never costs the session the rest of the brief.
 */
async function retroLine(
  event: SessionEvent,
  plans: Readonly<Record<string, string>>,
  deps: ContextDeps,
): Promise<string | null> {
  let since: string | null;
  try {
    since = lastRetrospective(plans);
  } catch (error) {
    if (error instanceof MarkerError) {
      return `Warning: ${error.message}`;
    }
    throw error;
  }
  const id =
    typeof event.session_id === "string" ? event.session_id : undefined;
  const sessions = await deps.sessionsSince(since, id);
  if (sessions < RETRO_AFTER_SESSIONS) {
    return null;
  }
  return since
    ? `${sessions} sessions since the last retrospective (${since}); run /retro.`
    : `${sessions} sessions without a recorded retrospective; run /retro.`;
}

/** The context for a SessionStart event: the brief on a fresh start, the rules after compaction. */
export async function restore(
  event: SessionEvent,
  deps: ContextDeps,
): Promise<string> {
  if (event.source === "startup" || event.source === "clear") {
    return brief(event, deps);
  }
  if (event.source !== "compact") {
    return "";
  }
  const sections = [
    "Context was compacted. Keep applying these AGENTS.md rules; hooks check only the parts marked Enforced or Audited:",
    ...rules(await deps.readAgents()),
  ];
  const plans = await deps.readPlans();
  for (const plan of activePlans(plans)) {
    sections.push(
      "",
      `Open plan items in ${PLANS_DIR}/${plan}:`,
      ...openItems(plans[plan] ?? ""),
    );
  }
  return sections.join("\n");
}
