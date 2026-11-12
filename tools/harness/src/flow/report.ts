import type { Kind, LedgerEvent } from "../ledger/index.js";
import {
  APPROVAL_LABEL,
  GITHUB_STAGES,
  MAIN_SESSION_STAGE,
  ROLE_STAGES,
  STAGES,
  type Stage,
} from "./stages.js";

export const REPORT_VERSION = 1;

export interface StageTotals {
  stage: Stage;
  activeSeconds: number;
  waitingSeconds: number;
  events: number;
}

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
  /** Why there is no bottleneck; absent when one is named. */
  bottleneckNote?: string;
  /** Events with no stage or no idea, left out of every stage. */
  unmappedEvents: number;
}

export interface ReportOptions {
  /** Open GitHub states (an unapproved issue, an unmerged PR) are measured to here. */
  asOf: Date;
  minCompletedIdeas: number;
}

type Span = [number, number];
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

/** The part of `span` outside every span in `holes`, summed in milliseconds. */
function uncovered(span: Span, holes: Span[]): number {
  const sorted = holes
    .map(([a, b]): Span => [Math.max(a, span[0]), Math.min(b, span[1])])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let free = span[1] - span[0];
  let reached = span[0];
  for (const [a, b] of sorted) {
    const from = Math.max(a, reached);
    if (b > from) {
      free -= b - from;
      reached = b;
    }
  }
  return free;
}

function roleOf(event: LedgerEvent) {
  for (const name of [event.agent, event.pane, event.session]) {
    const role = name?.split("-").at(-1);
    if (role !== undefined && Object.hasOwn(ROLE_STAGES, role)) {
      return ROLE_STAGES[role];
    }
  }
  return undefined;
}

/** Idea keys: an issue's own number, else what the event, its pane or its session names. */
function attribute(events: LedgerEvent[]): Map<string, string | undefined> {
  const byActor = new Map<string, string>();
  const actors = (e: LedgerEvent) =>
    [e.pane && `pane:${e.pane}`, e.session && `session:${e.session}`].filter(
      (a): a is string => typeof a === "string",
    );
  for (const event of events) {
    if (event.idea !== undefined) {
      for (const actor of actors(event)) {
        byActor.set(actor, event.idea);
      }
    }
  }
  const result = new Map<string, string | undefined>();
  for (const event of events) {
    const own = event.kind.startsWith("issue.")
      ? `#${event.number}`
      : undefined;
    const inherited = actors(event)
      .map((a) => byActor.get(a))
      .find((i) => i !== undefined);
    result.set(event.id, event.idea ?? own ?? inherited);
  }
  return result;
}

class Tally {
  readonly totals = new Map<Stage, StageTotals>(
    STAGES.map((stage) => [
      stage,
      { stage, activeSeconds: 0, waitingSeconds: 0, events: 0 },
    ]),
  );

  add(stage: Stage, field: "activeSeconds" | "waitingSeconds", ms: number) {
    (this.totals.get(stage) as StageTotals)[field] += ms / 1000;
  }

  count(stage: Stage) {
    (this.totals.get(stage) as StageTotals).events += 1;
  }
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
    items.sort((a, b) => time(a.event) - time(b.event));
    let closedAt: number | undefined;
    for (let i = 0; i < items.length - 1; i += 1) {
      const current = items[i] as (typeof items)[number];
      const next = items[i + 1] as (typeof items)[number];
      const state = STATE_AFTER[current.event.kind];
      if (closedAt === undefined && state === "closed") {
        closedAt = time(current.event);
      }
      if (closedAt === undefined && state !== undefined && state !== "closed") {
        tally.add(
          current.stage,
          state === "active" ? "activeSeconds" : "waitingSeconds",
          time(next.event) - time(current.event),
        );
      }
    }
    const first = items[0] as (typeof items)[number];
    const last = items.at(-1) as (typeof items)[number];
    // The orchestrator lives alongside every other stage, so it never hides their waits.
    if (first.stage !== "orchestrate") {
      lifetimes.push([time(first.event), closedAt ?? time(last.event)]);
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
        tally.add(stage, "waitingSeconds", uncovered([start, stop], holes));
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
  stages: StageTotals[],
  completed: number,
  minCompletedIdeas: number,
): Pick<FlowReport, "bottleneck" | "bottleneckNote"> {
  const waiting = stages.reduce((sum, s) => sum + s.waitingSeconds, 0);
  const worst = stages.reduce((a, b) =>
    b.waitingSeconds > a.waitingSeconds ? b : a,
  );
  if (completed < minCompletedIdeas) {
    return {
      bottleneck: null,
      bottleneckNote: `Not enough data: ${completed} of ${minCompletedIdeas} completed ideas needed to name a bottleneck.`,
    };
  }
  if (waiting === 0) {
    return {
      bottleneck: null,
      bottleneckNote: "No waiting time recorded, so there is no bottleneck.",
    };
  }
  return {
    bottleneck: {
      stage: worst.stage,
      waitingSeconds: worst.waitingSeconds,
      share: roundShare(worst.waitingSeconds / waiting),
    },
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
  const stages = [...tally.totals.values()];
  return {
    version: REPORT_VERSION,
    asOf: asOf.toISOString(),
    ideas: { total: byIdea.size, completed },
    minCompletedIdeas,
    stages,
    ...nameBottleneck(stages, completed, minCompletedIdeas),
    unmappedEvents: unmapped,
  };
}
