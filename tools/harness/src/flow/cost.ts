import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

export const DEFAULT_TRAILING_IDEAS = 5;
export const DEFAULT_MAX_INCREASE = 0.25;

/** How much a metric may rise above its trailing average before it counts as worse. */
export interface Threshold {
  /** 0.25 means worsened above 125% of the trailing average. */
  maxIncrease: number;
}

export interface CostOptions {
  /** How many closed ideas the trailing average covers. */
  trailingIdeas: number;
  tokensPerIdea: Threshold;
  sessionsPerIdea: Threshold;
}

export const DEFAULT_COST: CostOptions = {
  trailingIdeas: DEFAULT_TRAILING_IDEAS,
  tokensPerIdea: { maxIncrease: DEFAULT_MAX_INCREASE },
  sessionsPerIdea: { maxIncrease: DEFAULT_MAX_INCREASE },
};

export type CostMetric =
  | {
      status: "ok";
      /** The most recently closed idea, whose value is `current`. */
      currentIdea: string;
      current: number;
      /** Mean over the last `trailingIdeas` closed ideas, the current one included. */
      trailingAverage: number;
      maxIncrease: number;
      worsened: boolean;
    }
  | { status: "insufficient history"; closedIdeas: number; needed: number };

export interface CostMetrics {
  trailingIdeas: number;
  tokensPerIdea: CostMetric;
  sessionsPerIdea: CostMetric;
}

/**
 * Tokens are cumulative per session, so each session counts its latest
 * token.usage once; sessions are the session.launch events.
 */
function costOf(own: LedgerEvent[]) {
  const latest = new Map<string, { at: number; tokens: number }>();
  let sessions = 0;
  for (const event of own) {
    if (event.kind === "session.launch") {
      sessions += 1;
    } else if (event.kind === "token.usage" && event.tokens !== undefined) {
      const key = event.session ?? event.pane ?? event.id;
      const seen = latest.get(key);
      if (seen === undefined || time(event) >= seen.at) {
        latest.set(key, { at: time(event), tokens: event.tokens });
      }
    }
  }
  const measured = latest.size > 0;
  const tokens = [...latest.values()].reduce((sum, v) => sum + v.tokens, 0);
  return { tokens, measured, sessions };
}

function metric(
  values: { idea: string; value: number }[],
  trailing: number,
  { maxIncrease }: Threshold,
): CostMetric {
  if (values.length < trailing) {
    return {
      status: "insufficient history",
      closedIdeas: values.length,
      needed: trailing,
    };
  }
  const last = values.slice(-trailing);
  const current = last[last.length - 1] as (typeof last)[number];
  const trailingAverage =
    last.reduce((sum, v) => sum + v.value, 0) / last.length;
  return {
    status: "ok",
    currentIdea: current.idea,
    current: current.value,
    trailingAverage,
    maxIncrease,
    worsened: current.value > trailingAverage * (1 + maxIncrease),
  };
}

/**
 * Tokens and sessions per closed idea, from ledger events only. Ideas are
 * ordered by when they closed; the trailing average covers the last N.
 */
export function costMetrics(
  byIdea: Map<string, LedgerEvent[]>,
  window: Span,
  options: CostOptions,
): CostMetrics {
  const closed: {
    idea: string;
    at: number;
    tokens: number;
    measured: boolean;
    sessions: number;
  }[] = [];
  for (const [idea, own] of byIdea) {
    const at = own
      .filter((e) => e.kind === "issue.closed")
      .map(time)
      .sort((a, b) => a - b)[0];
    if (at !== undefined && inWindow(window, at)) {
      closed.push({ idea, at, ...costOf(own) });
    }
  }
  closed.sort(
    (a, b) =>
      a.at - b.at || a.idea.localeCompare(b.idea, undefined, { numeric: true }),
  );
  const { trailingIdeas } = options;
  return {
    trailingIdeas,
    tokensPerIdea: metric(
      // An idea with no token.usage was not measured; it is not a zero.
      closed
        .filter((c) => c.measured)
        .map((c) => ({ idea: c.idea, value: c.tokens })),
      trailingIdeas,
      options.tokensPerIdea,
    ),
    sessionsPerIdea: metric(
      closed.map((c) => ({ idea: c.idea, value: c.sessions })),
      trailingIdeas,
      options.sessionsPerIdea,
    ),
  };
}
