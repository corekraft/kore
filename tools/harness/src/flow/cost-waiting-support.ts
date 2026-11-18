// Shared arithmetic of the token cost figures: each session's window spend, and summaries. Every
// dollar and token count comes from the writer cost reading (writer-dollars.ts) and the plan weights
// (plan-tokens.ts); nothing here reads a price of its own.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";
import { MAIN_SESSION_STAGE } from "./stages.js";
import { planWeightedTokens, type PlanTokenCounts } from "./plan-tokens.js";
import { median } from "./wip.js";
import {
  NO_COUNTS,
  priceCounts,
  spendBefore,
  subCounts,
  type Counts,
  type PriceTable,
} from "./writer-dollars.js";
import type { Summary } from "./cost-waiting-types.js";

/** The session a token reading belongs to: its agent, else its session, else its pane (as spendBefore keys it). */
export const keyOf = (event: LedgerEvent): string | undefined =>
  event.agent ?? event.session ?? event.pane;

/** The sum of every token kind across both prompt steps. */
export function tokensOf(counts: Counts): number {
  return [counts.low, counts.high].reduce(
    (sum, kinds) =>
      sum +
      kinds.input +
      kinds.cacheWrite5m +
      kinds.cacheWrite1h +
      kinds.cacheRead +
      kinds.output,
    0,
  );
}

/** The plan-weighted tokens of one model's counts, or undefined for a model the plan weights do not read. */
function planOf(model: string, counts: Counts): number | undefined {
  const plan: PlanTokenCounts = {
    model,
    lowInput: counts.low.input,
    lowCacheWrite5m: counts.low.cacheWrite5m,
    lowCacheWrite1h: counts.low.cacheWrite1h,
    lowCacheRead: counts.low.cacheRead,
    lowOutput: counts.low.output,
    highInput: counts.high.input,
    highCacheWrite5m: counts.high.cacheWrite5m,
    highCacheWrite1h: counts.high.cacheWrite1h,
    highCacheRead: counts.high.cacheRead,
    highOutput: counts.high.output,
  };
  return planWeightedTokens(plan);
}

/** A nearest-rank 90th percentile; null with no value. */
function p90Of(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.9 * sorted.length) - 1] ?? null;
}

export const round = (value: number, places = 4) =>
  Math.round(value * 10 ** places) / 10 ** places;

/** The total, median and 90th percentile of per-session or per-change values. */
export function summaryOf(values: number[]): Summary {
  return {
    total: round(values.reduce((sum, v) => sum + v, 0)),
    median: median(values),
    p90: p90Of(values),
  };
}

/** One session's window spend: its tokens, its dollars, its plan-weighted tokens and the models it could not price. */
export interface SessionWindow {
  key: string;
  named: boolean;
  tokens: number;
  dollars: number;
  plan: number;
  unpriced: string[];
}

/**
 * Each session that read tokens inside the window: the growth of its cumulative counts between the
 * window's start and end, per model, priced at the table and weighted for the plan.
 */
export function sessionsInWindow(
  events: LedgerEvent[],
  window: Span,
  prices: PriceTable,
): SessionWindow[] {
  const stage = () => MAIN_SESSION_STAGE;
  const start = spendBefore(events, window[0], stage);
  const end = spendBefore(events, window[1], stage);
  const keysOf = (list: LedgerEvent[]) =>
    new Set(list.map(keyOf).filter((key): key is string => key !== undefined));
  const inside = keysOf(
    events.filter(
      (e) =>
        e.kind === "token.split" &&
        e.model !== undefined &&
        inWindow(window, time(e)),
    ),
  );
  const named = keysOf(events.filter((e) => e.agent !== undefined));
  return [...end]
    .filter(([key]) => inside.has(key))
    .map(([key, spend]) => {
      const before = start.get(key)?.byModel ?? new Map<string, Counts>();
      const row: SessionWindow = {
        key,
        named: named.has(key),
        tokens: 0,
        dollars: 0,
        plan: 0,
        unpriced: [],
      };
      for (const [model, counts] of spend.byModel) {
        const grown = subCounts(counts, before.get(model) ?? NO_COUNTS);
        row.tokens += tokensOf(grown);
        const dollars = priceCounts(grown, model, prices);
        const plan = planOf(model, grown);
        if (dollars === undefined || plan === undefined) {
          row.unpriced.push(model);
        } else {
          row.dollars += dollars;
          row.plan += plan;
        }
      }
      return row;
    });
}

/** The cumulative spend of a set of events at a time: each session's tokens, dollars and unpriced models. */
export function cumulativeOf(
  events: LedgerEvent[],
  at: number,
  prices: PriceTable,
): { tokens: number; dollars: number } {
  let tokens = 0;
  let dollars = 0;
  for (const spend of spendBefore(
    events,
    at,
    () => MAIN_SESSION_STAGE,
  ).values()) {
    for (const [model, counts] of spend.byModel) {
      tokens += tokensOf(counts);
      dollars += priceCounts(counts, model, prices) ?? 0;
    }
  }
  return { tokens, dollars };
}

/** The token price table: one dollar per token, so a figure priced with it reads tokens. */
export function tokenPricesOf(events: LedgerEvent[]): PriceTable {
  const perMillion = 1_000_000;
  const rates = {
    inputPerMTok: perMillion,
    cacheWrite5mPerMTok: perMillion,
    cacheWrite1hPerMTok: perMillion,
    cacheReadPerMTok: perMillion,
    outputPerMTok: perMillion,
  };
  const models = new Set(
    events
      .filter((e) => e.kind === "token.split" && e.model !== undefined)
      .map((e) => e.model as string),
  );
  return Object.fromEntries([...models].map((model) => [model, rates]));
}

/** The share of the weekly ceiling a plan-weighted token count is, or "not set" with no ceiling. */
export function shareOf(plan: number, ceiling: number | undefined) {
  return ceiling === undefined ? ("not set" as const) : round(plan / ceiling);
}
