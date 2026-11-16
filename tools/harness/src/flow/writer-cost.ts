// Writer cost per merged change by tier (#868, parent #825): each writer tier's tokens
// in the window, weighted by its price, over the merged changes, with the follow-ups
// per session and the blocked share beside it. The same figure over the trailing
// days is the average. Orchestrating tokens are reported beside the tiers, weighted at
// the main-session model.

import type { LedgerEvent } from "../ledger/index.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import { time } from "./github-waits.js";
import {
  DEFAULT_MERGED_TRAILING_DAYS,
  mergedIn,
  trailingBefore,
} from "./merged-span.js";
import { countsBefore, tokenSession } from "./merged-tokens.js";
import { inWindow, type Span } from "./scope.js";
import { tokenStageResolver } from "./stage-of.js";
import { MODEL_PRICES, PRICES_AS_OF, priceWeight } from "./writer-prices.js";

/**
 * The model the orchestrating session runs on. The ledger records no model for the
 * main session, so its tokens are weighted at this one; an assumption to re-check.
 */
export const MAIN_SESSION_MODEL = "claude-opus-5-5";

export interface WriterTierFigure {
  /** Writer sessions launched in the span on this tier. */
  sessions: number;
  /** The tier's tokens in the span, each weighted by the tier's price. */
  weightedTokens: number;
  /** The tier's weighted tokens over the span's merged changes. */
  perMergedChange: number;
  /** Follow-ups sent to the tier's writer panes over its sessions; null with no session. */
  followUpsPerSession: number | null;
  /** Tier sessions whose latest result the span has. */
  finished: number;
  /** Of the finished sessions, those whose latest result was blocked. */
  blocked: number;
  /** blocked over finished; null with none finished. */
  blockedShare: number | null;
}

export type WriterCostFigure =
  | {
      status: "ok";
      merged: number;
      /** The orchestrating session's tokens, weighted at the main-session model. */
      orchestrate: { weightedTokens: number; perMergedChange: number };
      /** Every priced model, so a tier with no session is shown as zero. */
      tiers: Record<string, WriterTierFigure>;
    }
  | {
      status: "insufficient merged changes";
      merged: number;
      /** The minimum merged changes a span needs before its figure is read. */
      needed: number;
    };

export interface WriterCost {
  /** The date the price table was read. */
  pricesAsOf: string;
  /** The trailing days the average covers. */
  trailingDays: number;
  /** The fewest merged changes a span needs before its figure is read. */
  minMergedChanges: number;
  current: WriterCostFigure;
  /** The same figure over the trailing days before the window. */
  trailingAverage: WriterCostFigure;
}

export interface WriterCostOptions {
  trailingDays: number;
  minMergedChanges: number;
  /** Where the trailing days end when the window has no start. */
  asOf: Date;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** A writer launch on a priced tier: its session name, pane, tier and launch time. */
interface PricedLaunch {
  agent: string | undefined;
  pane: string | undefined;
  tier: string;
  at: number;
}

function pricedLaunches(events: LedgerEvent[]): PricedLaunch[] {
  return events
    .filter(
      (e) =>
        e.kind === "session.launch" &&
        e.role === "writer" &&
        e.tier !== undefined &&
        priceWeight(e.tier) !== undefined,
    )
    .map((e) => ({
      agent: e.agent,
      pane: e.pane,
      tier: e.tier as string,
      at: time(e),
    }));
}

/** The latest token reading's event for each session, which names its agent and stage. */
function latestReadings(events: LedgerEvent[]): Map<string, LedgerEvent> {
  const latest = new Map<string, { at: number; event: LedgerEvent }>();
  for (const event of events) {
    if (event.kind !== "token.usage" || event.tokens === undefined) {
      continue;
    }
    const key = tokenSession(event);
    const at = time(event);
    const seen = latest.get(key);
    if (seen === undefined || at >= seen.at) {
      latest.set(key, { at, event });
    }
  }
  return new Map([...latest].map(([key, v]) => [key, v.event]));
}

/** Each priced writer's tier, by session name. */
function tierByAgent(events: LedgerEvent[]): Map<string, string> {
  const tierOf = new Map<string, string>();
  for (const l of pricedLaunches(events)) {
    if (l.agent !== undefined) {
      tierOf.set(l.agent, l.tier);
    }
  }
  return tierOf;
}

/** Each session's latest result before the span's end, by session name. */
function latestResults(events: LedgerEvent[], end: number) {
  const latest = new Map<string, { at: number; result: string | undefined }>();
  for (const e of events) {
    if (e.kind !== "session.result" || e.agent === undefined) {
      continue;
    }
    const at = time(e);
    const seen = latest.get(e.agent);
    if (at < end && (seen === undefined || at >= seen.at)) {
      latest.set(e.agent, { at, result: e.result });
    }
  }
  return latest;
}

/** Each tier's weighted tokens in the span, and the orchestrating session's, weighted at the main-session model. */
function weightedTokensIn(events: LedgerEvent[], span: Span) {
  const tierOf = tierByAgent(events);
  const stageOf = tokenStageResolver(events);
  const owners = latestReadings(events);
  const end = countsBefore(events, span[1]);
  const start = countsBefore(events, span[0]);
  const byTier = new Map<string, number>();
  const spent = new Set<string>();
  let orchestrate = 0;
  for (const [key, tokens] of end) {
    const owner = owners.get(key);
    if (owner === undefined) {
      continue;
    }
    const delta = tokens - (start.get(key) ?? 0);
    const stage = stageOf(owner);
    if (stage === "orchestrate") {
      orchestrate += delta * (priceWeight(MAIN_SESSION_MODEL) ?? 0);
    }
    const tier =
      stage === "write" && owner.agent !== undefined
        ? tierOf.get(owner.agent)
        : undefined;
    if (tier !== undefined && owner.agent !== undefined) {
      byTier.set(
        tier,
        (byTier.get(tier) ?? 0) + delta * (priceWeight(tier) ?? 0),
      );
      if (delta > 0) {
        spent.add(owner.agent);
      }
    }
  }
  return { byTier, orchestrate, spent };
}

/** Follow-ups sent in the span to each tier's writer panes. */
function sendsIn(events: LedgerEvent[], span: Span): Map<string, number> {
  const paneTier = new Map<string, string>();
  for (const l of pricedLaunches(events)) {
    if (l.pane !== undefined) {
      paneTier.set(l.pane, l.tier);
    }
  }
  const sends = new Map<string, number>();
  for (const e of events) {
    const tier =
      e.kind === "session.send" && e.pane !== undefined
        ? paneTier.get(e.pane)
        : undefined;
    if (tier !== undefined && inWindow(span, time(e))) {
      sends.set(tier, (sends.get(tier) ?? 0) + 1);
    }
  }
  return sends;
}

/** One tier's figure: its sessions, price, follow-ups and blocked share in the span. */
function tierFigure(
  launches: PricedLaunch[],
  results: Map<string, { at: number; result: string | undefined }>,
  weighted: number,
  sends: number,
  merged: number,
): WriterTierFigure {
  const finished = launches.filter(
    (l) => l.agent !== undefined && results.has(l.agent),
  );
  const blocked = finished.filter(
    (l) => results.get(l.agent as string)?.result === "blocked",
  );
  return {
    sessions: launches.length,
    weightedTokens: round(weighted),
    perMergedChange: round(weighted / merged),
    followUpsPerSession:
      launches.length === 0 ? null : round(sends / launches.length),
    finished: finished.length,
    blocked: blocked.length,
    blockedShare:
      finished.length === 0 ? null : round(blocked.length / finished.length),
  };
}

/** The figure for one span, insufficient below the minimum merged changes. */
function figureIn(
  events: LedgerEvent[],
  span: Span,
  minMergedChanges: number,
): WriterCostFigure {
  const merged = mergedIn(events, span);
  if (merged < minMergedChanges) {
    return {
      status: "insufficient merged changes",
      merged,
      needed: minMergedChanges,
    };
  }
  const { byTier, orchestrate, spent } = weightedTokensIn(events, span);
  const sends = sendsIn(events, span);
  const results = latestResults(events, span[1]);
  // A writer is in the span when it launched in it or spent tokens in it, so its tokens and its count agree.
  const launches = pricedLaunches(events).filter(
    (l) =>
      inWindow(span, l.at) || (l.agent !== undefined && spent.has(l.agent)),
  );
  const tiers = Object.fromEntries(
    Object.keys(MODEL_PRICES).map((tier) => [
      tier,
      tierFigure(
        launches.filter((l) => l.tier === tier),
        results,
        byTier.get(tier) ?? 0,
        sends.get(tier) ?? 0,
        merged,
      ),
    ]),
  );
  return {
    status: "ok",
    merged,
    orchestrate: {
      weightedTokens: round(orchestrate),
      perMergedChange: round(orchestrate / merged),
    },
    tiers,
  };
}

/** Writer cost per merged change by tier over the window, with the trailing days before it as the average. */
export function writerCost(
  events: LedgerEvent[],
  window: Span,
  { trailingDays, minMergedChanges, asOf }: WriterCostOptions,
): WriterCost {
  return {
    pricesAsOf: PRICES_AS_OF,
    trailingDays,
    minMergedChanges,
    current: figureIn(events, window, minMergedChanges),
    trailingAverage: figureIn(
      events,
      trailingBefore(window, trailingDays, asOf),
      minMergedChanges,
    ),
  };
}

/** Writer cost per merged change by tier, read against the minimum merged changes the cost settings give. */
export function mergedChangeWriterCost(
  events: LedgerEvent[],
  window: Span,
  { asOf, cost = {} }: { asOf: Date; cost?: Partial<CostOptions> },
): WriterCost {
  return writerCost(events, window, {
    trailingDays: DEFAULT_MERGED_TRAILING_DAYS,
    minMergedChanges: { ...DEFAULT_COST, ...cost }.minMergedChanges,
    asOf,
  });
}
