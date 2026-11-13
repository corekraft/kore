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
import {
  firstClosed,
  guardBlocks,
  ideaMetrics,
  outcomes,
  type CostMetrics,
  type GuardBlocks,
  type Outcomes,
  type CostOptions,
  type LeadTime,
} from "./idea-metrics.js";
import {
  inWindow,
  scopeOf,
  windowOf,
  type Scope,
  type Span,
  type ScopeOptions,
} from "./scope.js";

export const REPORT_VERSION = 6;

export type { StageTotals, Toil } from "./tally.js";
export type { Scope, ScopeOptions } from "./scope.js";

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
  /** The range and ideas the report covers. */
  scope: Scope;
  ideas: { total: number; completed: number };
  minCompletedIdeas: number;
  stages: StageTotals[];
  leadTime: LeadTime;
  /** Tokens and sessions per closed idea, each with a trailing average. */
  metrics: CostMetrics;
  bottleneck: Bottleneck | null;
  /** Why `bottleneck` is null; null when one is named. */
  bottleneckNote: string | null;
  /** Events with no stage or no idea, left out of every stage. */
  unmappedEvents: number;
  /** How much of the work the report can place: events with an idea, and with an idea and a stage. */
  attribution: { events: number; withIdea: number; withIdeaAndStage: number };
  /** Guard blocks per rule, most blocked first. */
  guardBlocks: GuardBlocks[];
  /** Metrics no agent can set: main-red rate, reverts, live-run pass rate and owner minutes. */
  outcomes: Outcomes;
}

export interface ReportOptions extends ScopeOptions {
  /** Open GitHub states (an unapproved issue, an unmerged PR) are measured to here. */
  asOf: Date;
  minCompletedIdeas: number;
  /** Trailing window and thresholds for the cost metrics; defaults apply to what is left out. */
  cost?: Partial<CostOptions>;
}

const COST_KINDS = new Set<Kind>(["token.usage", "session.launch"]);

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
  // A claude session no agent name reaches, stamped or from its pane, is the main session.
  return event.agent === undefined && event.source === "claude"
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
): { unmapped: number; mapped: number } {
  tally.beginIdea();
  const mergedAt = firstTime(own, (e) => e.kind === "pr.merged");
  const mapped: { event: LedgerEvent; stage: Stage }[] = [];
  let unmapped = 0;
  let mappedInRange = 0;
  for (const event of own) {
    if (COST_KINDS.has(event.kind)) {
      // Cost events feed the cost metrics only; they are neither stage time nor unmapped.
      continue;
    }
    const stage = stageOf(event, mergedAt);
    const inRange = inWindow(tally.window, time(event));
    if (stage !== undefined) {
      if (inRange) {
        tally.count(stage);
        tally.present(stage, time(event), time(event));
        mappedInRange += 1;
      }
      mapped.push({ event, stage });
    } else if (inRange) {
      unmapped += 1;
    }
  }
  githubWaits(tally, waits, actorTime(tally, mapped));
  tally.endIdea();
  return { unmapped, mapped: mappedInRange };
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
  const { byIdea, unattributed, orphans, named } = groupByIdea(events, window);
  const covered = select(byIdea, scope, window, asOf.getTime());
  const tally = new Tally(window);
  const ownByIdea = new Map<string, LedgerEvent[]>();
  let unmapped = 0;
  let completed = 0;
  let mappedEvents = 0;
  let ideaEvents = 0;
  for (const [idea, { own, waits }] of covered) {
    ownByIdea.set(idea, own);
    const charged = chargeIdea(tally, own, waits);
    unmapped += charged.unmapped;
    mappedEvents += charged.mapped;
    ideaEvents += charged.mapped + charged.unmapped;
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
    ...ideaMetrics(ownByIdea, window, options.cost),
    ...nameBottleneck(tally, completed, minCompletedIdeas),
    unmappedEvents: unmapped,
    attribution: {
      events:
        ideaEvents +
        (scope.ideas === null
          ? orphans.filter((e) => !COST_KINDS.has(e.kind)).length
          : 0),
      withIdea: ideaEvents,
      withIdeaAndStage: mappedEvents,
    },
    guardBlocks: guardBlocks(named, window),
    outcomes: outcomes(named, window),
  };
}
