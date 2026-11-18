// Writer cost per merged change by tier (#868, parent #825): each writer tier's tokens
// in the window, weighted by its price, over the merged changes, with the follow-ups
// per session and the blocked share beside it. The same figure over the trailing
// days is the average. Orchestrating tokens are reported beside the tiers, weighted at
// the main-session model. Each tier also reads its own figure over the merged changes
// joined to it (#1007, writer-join.ts), and its all-in dollars per merged change (#1008,
// writer-attribution.ts).

import type { LedgerEvent } from "../ledger/index.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import {
  DEFAULT_MERGED_TRAILING_DAYS,
  mergedIn,
  trailingBefore,
} from "./merged-span.js";
import { inWindow, type Span } from "./scope.js";
import {
  latestResults,
  MAIN_SESSION_MODEL,
  sendsIn,
  weightedTokensIn,
} from "./writer-usage.js";
import {
  MODEL_PRICES,
  PRICES_AS_OF,
  type ModelPrice,
} from "./writer-prices.js";
import {
  sharedFigure,
  tierDollarsIn,
  writerDollarsIn,
  type InsufficientPrices,
  type TierDollars,
  type WriterDollars,
} from "./writer-attribution.js";
import {
  NO_TIER_FIELDS,
  tierJoinsIn,
  type PricedLaunch,
  type TierFigureFields,
} from "./writer-tier-figures.js";

/** A shared part of the figure: its dollars and its dollars per merged change, or the unpriced models it cannot read. */
export type SharedDollars =
  { dollars: number; dollarsPerMergedChange: number } | InsufficientPrices;

/**
 * The relaunch limit the report states beside each figure: the join reads a relaunch on a new
 * session with no idea stamp as that relaunch's tier, never the first launch's.
 */
export const RELAUNCH_LIMIT =
  "A relaunch on a new session with no idea stamp cannot be joined to the first launch: its merged change takes the relaunch's tier, not the first launch's.";

export interface WriterTierFigure extends TierFigureFields {
  /** Writer sessions launched in the span on this tier. */
  sessions: number;
  /** The tier's tokens in the span, each weighted by the tier's price. */
  weightedTokens: number;
  /**
   * SUPERSEDED: the tier's weighted tokens over all the span's merged changes, kept unchanged
   * until readers move to perMergedChangeByTier. Do not read it as a per-tier figure.
   */
  perMergedChange: number;
  /** The merged changes in the span joined to this tier by their pull request's link event. */
  mergedChanges: number;
  /** The tier's weighted tokens over its own merged changes; null with none joined to the tier. */
  perMergedChangeByTier: number | null;
  /** Follow-ups sent to the tier's writer panes over its sessions; null with no session. */
  followUpsPerSession: number | null;
  /** Tier sessions whose latest result the span has. */
  finished: number;
  /** Of the finished sessions, those whose latest result was blocked. */
  blocked: number;
  /** blocked over finished; null with none finished. */
  blockedShare: number | null;
  /**
   * All-in dollars per merged change joined to this tier (#1008): the writer, reviewer and shared
   * parts as means, their sum, and the median of the per-change totals; null with none joined;
   * insufficient prices when a model the price table does not price ran in its changes or the span.
   */
  perMergedChangeDollars: TierDollars | InsufficientPrices | null;
}

export type WriterCostFigure =
  | {
      status: "ok";
      merged: number;
      /** Merged changes in the span that join to no priced tier, counted and in no tier. */
      unjoinable: number;
      /** The limit of the join, stated beside the figure (see RELAUNCH_LIMIT). */
      relaunchLimit: string;
      /**
       * The orchestrating session's tokens, weighted at the main-session model (token.usage holds no
       * model). Its dollars are priced per recorded model from token.split readings, and at the assumed
       * model for tokens with no reading (#1008, #1041).
       */
      orchestrate: {
        weightedTokens: number;
        perMergedChange: number;
        /** The assumed main-session model: the weights, and what tokens with no reading are priced at. */
        model: string;
        /** What the dollars are priced from: recorded, assumed model, both, or none with no main-session tokens. */
        basis: WriterDollars["shared"]["orchestrateBasis"]["basis"];
        /** The models the span's token.split readings ran on, sorted, each once. */
        recordedModels: string[];
        /** The span's token totals with no reading, priced at the assumed model. */
        assumedTokens: number;
      } & SharedDollars;
      /**
       * The idea-wide judge sessions' dollars in the span, shared equally per merged change. Reviewers
       * are not here: each is charged to its own change (#1008).
       */
      judge: SharedDollars;
      /** Writer sessions with spend before the span's end and no merged change linked to them: a stated limit, in no tier. */
      unmergedWriterSessions: number;
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
  /** The price table the dollars are priced from; the published table when left out (#1008). */
  prices?: Readonly<Record<string, ModelPrice>>;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** What one tier's figure is read from: its tokens, follow-ups and joined merged changes, against the span's merged changes. */
interface TierInputs {
  weighted: number;
  sends: number;
  merged: number;
  mergedChanges: number;
}

/** One tier's figure: its sessions, price, follow-ups, joined merged changes and blocked share in the span. */
function tierFigure(
  launches: PricedLaunch[],
  results: Map<string, { at: number; result: string | undefined }>,
  inputs: TierInputs,
  dollars: TierDollars | InsufficientPrices | null,
  fields: TierFigureFields,
): WriterTierFigure {
  const { weighted, sends, merged, mergedChanges } = inputs;
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
    mergedChanges,
    perMergedChangeByTier:
      mergedChanges === 0 ? null : round(weighted / mergedChanges),
    followUpsPerSession:
      launches.length === 0 ? null : round(sends / launches.length),
    finished: finished.length,
    blocked: blocked.length,
    blockedShare:
      finished.length === 0 ? null : round(blocked.length / finished.length),
    perMergedChangeDollars: dollars,
    ...fields,
  };
}

/** The figure for one span, insufficient below the minimum merged changes. */
function figureIn(
  events: LedgerEvent[],
  span: Span,
  minMergedChanges: number,
  prices: Readonly<Record<string, ModelPrice>>,
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
  const tiersKeys = Object.keys(MODEL_PRICES);
  const joins = tierJoinsIn(events, span, tiersKeys);
  const dollars = writerDollarsIn(events, span, prices);
  // A writer is in the span when it launched in it or spent tokens in it, so its tokens and its count agree.
  const launches = joins.launches.filter(
    (l) =>
      inWindow(span, l.at) || (l.agent !== undefined && spent.has(l.agent)),
  );
  const tiers = Object.fromEntries(
    tiersKeys.map((tier) => [
      tier,
      tierFigure(
        launches.filter((l) => l.tier === tier),
        results,
        {
          weighted: byTier.get(tier) ?? 0,
          sends: sends.get(tier) ?? 0,
          merged,
          mergedChanges: joins.joined.get(tier) ?? 0,
        },
        tierDollarsIn(dollars, tier),
        joins.figures.get(tier) ?? NO_TIER_FIELDS,
      ),
    ]),
  );
  return {
    status: "ok",
    merged,
    unjoinable: joins.unjoinable,
    relaunchLimit: RELAUNCH_LIMIT,
    orchestrate: {
      weightedTokens: round(orchestrate),
      perMergedChange: round(orchestrate / merged),
      model: MAIN_SESSION_MODEL,
      basis: dollars.shared.orchestrateBasis.basis,
      recordedModels: dollars.shared.orchestrateBasis.recordedModels,
      assumedTokens: dollars.shared.orchestrateBasis.assumedTokens,
      ...sharedFigure(
        dollars.shared.orchestrate,
        dollars.shared.orchestrateUnpriced,
        merged,
      ),
    },
    judge: sharedFigure(
      dollars.shared.judge,
      dollars.shared.judgeUnpriced,
      merged,
    ),
    unmergedWriterSessions: dollars.unmergedWriterSessions,
    tiers,
  };
}

/** Writer cost per merged change by tier over the window, with the trailing days before it as the average. */
export function writerCost(
  events: LedgerEvent[],
  window: Span,
  {
    trailingDays,
    minMergedChanges,
    asOf,
    prices = MODEL_PRICES,
  }: WriterCostOptions,
): WriterCost {
  return {
    pricesAsOf: PRICES_AS_OF,
    trailingDays,
    minMergedChanges,
    current: figureIn(events, window, minMergedChanges, prices),
    trailingAverage: figureIn(
      events,
      trailingBefore(window, trailingDays, asOf),
      minMergedChanges,
      prices,
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
