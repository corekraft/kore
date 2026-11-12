import type { Kind, LedgerEvent } from "../ledger/index.js";
import {
  APPROVAL_LABEL,
  GITHUB_STAGES,
  MAIN_SESSION_STAGE,
  ROLE_STAGES,
  type Stage,
} from "./stages.js";
import { attribute } from "./attribution.js";
import { uncovered, type Span } from "./intervals.js";
import { chargeToil, newLife } from "./toil.js";
import { Tally, type StageTotals } from "./tally.js";

export const REPORT_VERSION = 2;

export type { StageTotals, Toil } from "./tally.js";

export interface Bottleneck {
  stage: Stage;
  waitingSeconds: number;
  /** The stage's waiting seconds over all stages' waiting seconds, 0 to 1. */
  share: number;
}

/** The `flow report --json` shape; `version` changes when a field does. */
export interface FlowReport {
  version: typeof REPORT_VERSION;
  asOf: string;
  ideas: { total: number; completed: number };
  minCompletedIdeas: number;
  stages: StageTotals[];
  bottleneck: Bottleneck | null;
  /** Why `bottleneck` is null; null when one is named. */
  bottleneckNote: string | null;
  /** Events with no stage or no idea, left out of every stage. */
  unmappedEvents: number;
}

export interface ReportOptions {
  /** Open GitHub states (an unapproved issue, an unmerged PR) are measured to here. */
  asOf: Date;
  minCompletedIdeas: number;
}

type State = "active" | "waiting" | "closed";

const STATE_AFTER: Partial<Record<Kind, State>> = {
  "session.start": "active",
  "tool.start": "active",
  "tool.end": "active",
  "pane.spawned": "active",
  "pane.busy": "active",
  "pane.waiting": "waiting",
  "pane.closed": "closed",
  "session.stop": "closed",
};

const time = (event: LedgerEvent) => Date.parse(event.occurredAt);

function roleOf(event: LedgerEvent) {
  for (const name of [event.agent, event.pane, event.session]) {
    const role = name?.split("-").at(-1);
    if (role !== undefined && Object.hasOwn(ROLE_STAGES, role)) {
      return ROLE_STAGES[role];
    }
  }
  return undefined;
}

/**
 * Charges one actor's time between its events to the state it was in and returns
 * one span per spawn-to-close life. A close holds until the next spawn or session
 * start, so a reused pane is not charged for the gap between lives.
 */
function chargeActor(
  tally: Tally,
  items: { event: LedgerEvent; stage: Stage }[],
): Span[] {
  const spans: Span[] = [];
  let closed = false;
  let start = time((items[0] as (typeof items)[number]).event);
  let life = newLife((items[0] as (typeof items)[number]).event);
  items.forEach(({ event, stage }, i) => {
    const at = time(event);
    if (
      closed &&
      (event.kind === "pane.spawned" || event.kind === "session.start")
    ) {
      closed = false;
      start = at;
      life = newLife(event);
    }
    const state = STATE_AFTER[event.kind];
    if (closed) {
      return;
    }
    chargeToil(
      (kind, ms) => tally.addToil(stage, kind, ms),
      event,
      at,
      start,
      life,
    );
    if (state === "closed") {
      closed = true;
      spans.push([start, at]);
    } else if (state !== undefined && i < items.length - 1) {
      const next = time((items[i + 1] as (typeof items)[number]).event);
      tally.add(
        stage,
        state === "active" ? "activeMs" : "waitingMs",
        next - at,
      );
      if (state === "waiting") {
        life.waits.push([at, next]);
        tally.addToil(stage, "waiting", next - at);
      }
    }
  });
  if (!closed) {
    spans.push([start, time((items.at(-1) as (typeof items)[number]).event)]);
  }
  return spans;
}

/** Charges each actor's time between its events to the state it was in. */
function actorTime(
  tally: Tally,
  events: { event: LedgerEvent; stage: Stage }[],
): Span[] {
  const byActor = new Map<string, typeof events>();
  for (const item of events) {
    const key = item.event.pane ?? item.event.session;
    if (key !== undefined) {
      byActor.set(key, [...(byActor.get(key) ?? []), item]);
    }
  }
  const lifetimes: Span[] = [];
  for (const items of byActor.values()) {
    items.sort((x, y) => time(x.event) - time(y.event));
    // The orchestrator lives alongside every other stage, so it never hides their waits.
    const spans = chargeActor(tally, items);
    if ((items[0] as (typeof items)[number]).stage !== "orchestrate") {
      lifetimes.push(...spans);
    }
  }
  return lifetimes;
}

function firstTime(events: LedgerEvent[], match: (e: LedgerEvent) => boolean) {
  return events
    .filter(match)
    .map(time)
    .sort((a, b) => a - b)[0];
}

/** Charges the GitHub waits: open issue until approval, open PR until merge. */
function githubWaits(
  tally: Tally,
  events: LedgerEvent[],
  holes: Span[],
  asOf: number,
) {
  const closed = firstTime(events, (e) => e.kind === "issue.closed");
  const waits: [Stage, number | undefined, number | undefined][] = [
    [
      "await approval",
      firstTime(events, (e) => e.kind === "issue.opened"),
      firstTime(
        events,
        (e) => e.kind === "issue.labelled" && e.label === APPROVAL_LABEL,
      ),
    ],
    [
      "merge",
      firstTime(events, (e) => e.kind === "pr.opened"),
      firstTime(events, (e) => e.kind === "pr.merged"),
    ],
  ];
  for (const [stage, start, end] of waits) {
    if (start !== undefined) {
      const stop = end ?? closed ?? asOf;
      if (stop > start) {
        tally.add(stage, "waitingMs", uncovered([start, stop], holes));
      }
    }
  }
}

function stageOf(event: LedgerEvent, mergedAt: number | undefined) {
  const github = GITHUB_STAGES[event.kind];
  if (github !== undefined) {
    return github;
  }
  if (event.kind === "issue.labelled") {
    return event.label === APPROVAL_LABEL ? "await approval" : undefined;
  }
  const role = roleOf(event);
  if (role !== undefined) {
    const gate = role.after === "pr.merged" ? mergedAt : undefined;
    const open =
      role.after === undefined || (gate !== undefined && time(event) >= gate);
    return open ? role.stage : undefined;
  }
  return event.pane === undefined && event.source === "claude"
    ? MAIN_SESSION_STAGE
    : undefined;
}

function roundShare(share: number): number {
  return Math.round(share * 10_000) / 10_000;
}

function groupByIdea(events: LedgerEvent[]) {
  const ideaOf = attribute(events);
  const byIdea = new Map<string, LedgerEvent[]>();
  let unattributed = 0;
  for (const event of events) {
    const idea = ideaOf.get(event.id);
    if (idea === undefined) {
      unattributed += 1;
    } else {
      byIdea.set(idea, [...(byIdea.get(idea) ?? []), event]);
    }
  }
  return { byIdea, unattributed };
}

/** Charges one idea's events to the tally; returns how many it could not map. */
function chargeIdea(tally: Tally, own: LedgerEvent[], asOf: number): number {
  const mergedAt = firstTime(own, (e) => e.kind === "pr.merged");
  const mapped: { event: LedgerEvent; stage: Stage }[] = [];
  for (const event of own) {
    const stage = stageOf(event, mergedAt);
    if (stage !== undefined) {
      tally.count(stage);
      mapped.push({ event, stage });
    }
  }
  githubWaits(tally, own, actorTime(tally, mapped), asOf);
  return own.length - mapped.length;
}

function nameBottleneck(
  tally: Tally,
  completed: number,
  minCompletedIdeas: number,
): Pick<FlowReport, "bottleneck" | "bottleneckNote"> {
  const stages = [...tally.totals.entries()];
  const totalMs = stages.reduce((sum, [, s]) => sum + s.waitingMs, 0);
  // Strictly greater, in loop order, so an exact tie names the earlier stage.
  const [stage, worst] = stages.reduce((a, b) =>
    b[1].waitingMs > a[1].waitingMs ? b : a,
  );
  if (completed < minCompletedIdeas) {
    return {
      bottleneck: null,
      bottleneckNote: `Not enough data: ${completed} of ${minCompletedIdeas} completed ideas needed to name a bottleneck.`,
    };
  }
  if (totalMs === 0) {
    return {
      bottleneck: null,
      bottleneckNote: "No waiting time recorded, so there is no bottleneck.",
    };
  }
  return {
    bottleneck: {
      stage,
      waitingSeconds: worst.waitingMs / 1000,
      share: roundShare(worst.waitingMs / totalMs),
    },
    bottleneckNote: null,
  };
}

/** Turns ledger events into per-stage active and waiting time, and names the bottleneck. */
export function buildReport(
  events: LedgerEvent[],
  { asOf, minCompletedIdeas }: ReportOptions,
): FlowReport {
  const { byIdea, unattributed } = groupByIdea(events);
  const tally = new Tally();
  let unmapped = unattributed;
  let completed = 0;
  for (const own of byIdea.values()) {
    unmapped += chargeIdea(tally, own, asOf.getTime());
    completed += own.some((e) => e.kind === "issue.closed") ? 1 : 0;
  }
  return {
    version: REPORT_VERSION,
    asOf: asOf.toISOString(),
    ideas: { total: byIdea.size, completed },
    minCompletedIdeas,
    stages: tally.stages(),
    ...nameBottleneck(tally, completed, minCompletedIdeas),
    unmappedEvents: unmapped,
  };
}
