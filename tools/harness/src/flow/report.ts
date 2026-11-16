import type { Kind, LedgerEvent } from "../ledger/index.js";
import { roleResolver, stageResolver, type Stage } from "./stage-of.js";
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
  COST_KINDS,
  frictionMetrics,
  DEFAULT_HOST_DAYS,
  DEFAULT_QUESTION_DAYS,
  guardBlocks,
  hostPressure,
  ownerQuestions,
  reviewMisses,
  type ReviewMisses,
  mergedChangeFigures,
  tierShares,
  ideaMetrics,
  measureAttribution,
  outcomes,
  unstampedSpawns,
  type UnstampedSpawns,
  finishDetection,
  type FinishDetection,
  type Attribution,
  type CostMetrics,
  type FrictionMetrics,
  type GuardBlocks,
  type HostPressure,
  type Outcomes,
  type CostOptions,
  type LeadTime,
  type OwnerQuestions,
  type MergedChangeFigures,
} from "./idea-metrics.js";
import {
  inWindow,
  scopeOf,
  windowOf,
  type Scope,
  type Span,
  type ScopeOptions,
} from "./scope.js";

export const REPORT_VERSION = 19;

export type { StageTotals, Toil } from "./tally.js";
export type { Scope, ScopeOptions } from "./scope.js";

export interface Bottleneck {
  stage: Stage;
  waitingSeconds: number;
  /** The stage's waiting seconds over all stages' waiting seconds, 0 to 1. */
  share: number;
}

/** The `flow report --json` shape; `version` changes when a field does. */
export interface FlowReport extends FrictionMetrics, MergedChangeFigures {
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
  /** How much of the work recorded since the stamp landed the report can place; earlier events stay unattributed and are not counted. */
  attribution: Attribution;
  /** Guard blocks per rule, most blocked first. */
  guardBlocks: GuardBlocks[];
  /** Metrics no agent can set: main-red rate, reverts, live-run pass rate and owner minutes. */
  outcomes: Outcomes;
  /** Swap and load by live-session count, with a trailing baseline, from host-sample events. */
  hostPressure: HostPressure;
  /** Owner questions per merged change over the window, with the trailing days before it (#859). */
  ownerQuestions: OwnerQuestions;
  /** Passed reviews later sent back for a rule break, and reviews that found a violation, each with the trailing days before it (#851). */
  reviewMisses: ReviewMisses;
  /** Launches per role by where the tier came from, with launches from before it was recorded as unknown. */
  tierShares: ReturnType<typeof tierShares>;
  /** Spawns in range that named no idea, and how many gave a --no-idea reason; not friction. */
  unstampedSpawns: UnstampedSpawns;
  /** Results the Stop hook recorded that session wait's pane.finished did not detect in time, and the lag of those it did (#853). */
  finishDetection: FinishDetection;
}

export interface ReportOptions extends ScopeOptions {
  /** Open GitHub states (an unapproved issue, an unmerged PR) are measured to here. */
  asOf: Date;
  minCompletedIdeas: number;
  /** Trailing window and thresholds for the cost metrics; defaults apply to what is left out. */
  cost?: Partial<CostOptions>;
  /** Days before the window the host-pressure baseline covers; defaults to several. */
  hostDays?: number;
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
    // The main session lives alongside every other stage, so it never hides their waits.
    const spans = chargeActor(tally, items);
    if ((items[0] as (typeof items)[number]).stage !== "orchestrate") {
      lifetimes.push(...spans);
    }
  }
  return lifetimes;
}

/** Charges one idea's in-range events to the tally; returns how many it could not map. */
function chargeIdea(
  tally: Tally,
  own: LedgerEvent[],
  waits: GithubWait[],
  stageOf: ReturnType<typeof stageResolver>,
): number {
  tally.beginIdea();
  const mergedAt = firstTime(own, (e) => e.kind === "pr.merged");
  const mapped: { event: LedgerEvent; stage: Stage }[] = [];
  let unmapped = 0;
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
      share: Math.round((worst.waitingMs / totalMs) * 10_000) / 10_000,
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
  const stageOf = stageResolver(events);
  const hasRole = roleResolver(events);
  const scope = scopeOf(options);
  const window = windowOf(options);
  const { byIdea, unattributed, orphans, named, landed } = groupByIdea(
    events,
    window,
  );
  const covered = select(byIdea, scope, window, asOf.getTime());
  const tally = new Tally(window);
  const ownByIdea = new Map<string, LedgerEvent[]>();
  let unmapped = 0;
  let completed = 0;
  for (const [idea, { own, waits }] of covered) {
    ownByIdea.set(idea, own);
    unmapped += chargeIdea(tally, own, waits, stageOf);
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
    ...frictionMetrics(named, ownByIdea, window, options.cost?.trailingIdeas),
    ...nameBottleneck(tally, completed, minCompletedIdeas),
    unmappedEvents: unmapped,
    attribution: measureAttribution(
      [...covered.values()].map((c) => c.own),
      scope.ideas === null ? orphans : [],
      window,
      landed,
      {
        hasStage: (event, own) =>
          stageOf(
            event,
            firstTime(own, (e) => e.kind === "pr.merged"),
          ) !== undefined,
        hasRole,
      },
    ),
    guardBlocks: guardBlocks(named, window),
    outcomes: outcomes(named, window),
    hostPressure: hostPressure(named, window, {
      trailingDays: options.hostDays ?? DEFAULT_HOST_DAYS,
      asOf,
    }),
    ownerQuestions: ownerQuestions(named, window, {
      trailingDays: DEFAULT_QUESTION_DAYS,
      asOf,
    }),
    reviewMisses: reviewMisses(named, window, { asOf }),
    ...mergedChangeFigures(named, window, options),
    tierShares: tierShares(named, window),
    unstampedSpawns: unstampedSpawns(named, window),
    finishDetection: finishDetection(named, window),
  };
}
