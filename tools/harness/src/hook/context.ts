// SessionStart hook. After compaction it restates the AGENTS.md rules and the
// active plans' open items, since compaction may drop them. On a fresh session
// or /clear it prints a short brief: where each active plan stands, its Next:
// line and upcoming steps, the last operation per environment, and whether a
// retrospective is due. The plans are read by the shared plan parser, so the
// brief, `plan active` and the handoff cannot disagree.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import {
  activePlans,
  listItems,
  nextStep,
  openCounts,
  openItems,
  upcomingSteps,
} from "../plan/index.js";
import { lastRetrospective } from "./retro-scan.js";

const PLANS_DIR = "infra/plans";
const RETRO_AFTER_SESSIONS = 5;

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
}

export interface SessionEvent {
  source?: unknown;
  session_id?: unknown;
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

/** A few lines for a fresh session: active plans, Next: lines, upcoming steps, environments, retrospective due. */
export async function brief(
  event: SessionEvent,
  deps: ContextDeps,
): Promise<string> {
  const plans = await deps.readPlans();
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
  lines.push(...environmentLines(await deps.readJournals()));
  const since = lastRetrospective(plans);
  const id =
    typeof event.session_id === "string" ? event.session_id : undefined;
  const sessions = await deps.sessionsSince(since, id);
  if (sessions >= RETRO_AFTER_SESSIONS) {
    lines.push(
      since
        ? `${sessions} sessions since the last retrospective (${since}); run /retro.`
        : `${sessions} sessions without a recorded retrospective; run /retro.`,
    );
  }
  return lines.join("\n");
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
