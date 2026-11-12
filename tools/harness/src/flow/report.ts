import type { Kind, LedgerEvent } from "../ledger/index.js";
import {
  APPROVAL_LABEL,
  GITHUB_STAGES,
  MAIN_SESSION_STAGE,
  ROLE_STAGES,
  type Stage,
} from "./stages.js";
import {
  firstTime,
  githubWaits,
  time,
  type GithubWait,
} from "./github-waits.js";
import { groupByIdea, select } from "./select.js";
import { chargeToil, newLife } from "./toil.js";
import { Tally, type StageTotals } from "./tally.js";
import { median } from "./wip.js";
import {
  inWindow,
  scopeOf,
  windowOf,
  type Scope,
  type Span,
  type ScopeOptions,
} from "./scope.js";

export const REPORT_VERSION = 4;

export type { StageTotals, Toil } from "./tally.js";
export type { Wip } from "./wip.js";
export type { Scope, ScopeOptions } from "./scope.js";

export interface Bottleneck {
  stage: Stage;
  waitingSeconds: number;
  /** The stage's waiting seconds over all stages' waiting seconds, 0 to 1. */
  share: number;
}

/** Seconds from each completed idea's first event to its outcome event. */
export interface LeadTime {
  ideas: { idea: string; seconds: number }[];
  /** Null when no idea has an outcome. */
  medianSeconds: number | null;
  maxSeconds: number | null;
}

/** The `flow report --json` shape; `version` changes when a field does. */
export interface FlowReport {
  version: typeof REPORT_VERSION;
  asOf: string;
  /** The range and ideas the report covers. */
  scope: Scope;
  ideas: { total: number; completed: number };
  minCompletedIdeas: number;
  stages: StageTotals[];
  leadTime: LeadTime;
  bottleneck: Bottleneck | null;
  /** Why `bottleneck` is null; null when one is named. */
  bottleneckNote: string | null;
  /** Events with no stage or no idea, left out of every stage. */
  unmappedEvents: number;
}

export interface ReportOptions extends ScopeOptions {
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
  let life = newLife((items[0] as (typeof items)[number]).event, tally.window);
  items.forEach(({ event, stage }, i) => {
    const at = time(event);
    if (
      closed &&
      (event.kind === "pane.spawned" || event.kind === "session.start")
    ) {
      closed = false;
      start = at;
      life = newLife(event, tally.window);
    }
    const state = STATE_AFTER[event.kind];
    if (closed) {
      return;
    }
    chargeToil(
      (kind, ms) => tally.addToilMs(stage, kind, ms),
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
      tally.add(stage, state === "active" ? "activeMs" : "waitingMs", at, next);
      tally.present(stage, at, next);
      if (state === "waiting") {
        life.waits.push([at, next]);
        tally.addToil(stage, "waiting", at, next);
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

/** Charges one idea's in-range events to the tally; returns how many it could not map. */
function chargeIdea(
  tally: Tally,
  own: LedgerEvent[],
  waits: GithubWait[],
): number {
  tally.beginIdea();
  const mergedAt = firstTime(own, (e) => e.kind === "pr.merged");
  const mapped: { event: LedgerEvent; stage: Stage }[] = [];
  let unmapped = 0;
  for (const event of own) {
    const stage = stageOf(event, mergedAt);
    const inRange = inWindow(tally.window, time(event));
    if (stage !== undefined) {
      if (inRange) {
        tally.count(stage);
        tally.present(stage, time(event), time(event));
      }
      mapped.push({ event, stage });
    } else if (inRange) {
      unmapped += 1;
    }
  }
  githubWaits(tally, waits, actorTime(tally, mapped));
  tally.endIdea();
  return unmapped;
}

const firstClosed = (own: LedgerEvent[]) =>
  firstTime(own, (e) => e.kind === "issue.closed");

/** Each idea completed in the range, from its first event to its first issue.closed, with median and maximum. */
function leadTime(byIdea: Map<string, LedgerEvent[]>, window: Span): LeadTime {
  const ideas: LeadTime["ideas"] = [];
  for (const [idea, own] of byIdea) {
    const outcome = firstClosed(own);
    if (outcome !== undefined && inWindow(window, outcome)) {
      const first = Math.min(...own.map(time));
      ideas.push({ idea, seconds: (outcome - first) / 1000 });
    }
  }
  ideas.sort((a, b) =>
    a.idea.localeCompare(b.idea, undefined, { numeric: true }),
  );
  const seconds = ideas.map((i) => i.seconds);
  return {
    ideas,
    medianSeconds: median(seconds),
    maxSeconds: seconds.length === 0 ? null : Math.max(...seconds),
  };
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

/**
 * Turns ledger events into per-stage active and waiting time, and names the
 * bottleneck. With a range, time is clipped at its edges and only events in it
 * count; with ideas, only those ideas are covered.
 */
export function buildReport(
  events: LedgerEvent[],
  options: ReportOptions,
): FlowReport {
  const { asOf, minCompletedIdeas } = options;
  const scope = scopeOf(options);
  const window = windowOf(options);
  const { byIdea, unattributed } = groupByIdea(events, window);
  const covered = select(byIdea, scope, window, asOf.getTime());
  const tally = new Tally(window);
  const ownByIdea = new Map<string, LedgerEvent[]>();
  let unmapped = 0;
  let completed = 0;
  for (const [idea, { own, waits }] of covered) {
    ownByIdea.set(idea, own);
    unmapped += chargeIdea(tally, own, waits);
    const outcome = firstClosed(own);
    completed += outcome !== undefined && inWindow(window, outcome) ? 1 : 0;
  }
  if (scope.ideas === null) {
    unmapped += unattributed;
  }
  return {
    version: REPORT_VERSION,
    asOf: asOf.toISOString(),
    scope,
    ideas: { total: covered.size, completed },
    minCompletedIdeas,
    stages: tally.stages(),
    leadTime: leadTime(ownByIdea, window),
    ...nameBottleneck(tally, completed, minCompletedIdeas),
    unmappedEvents: unmapped,
  };
}
