// Tokens by stage over a window, and the same per merged change with the trailing days
// before it as the average (#831, parent #808). A session's spend is charged to the
// stage it was launched into, else its role's, else orchestrate (tokenStageResolver).

import type { LedgerEvent } from "../ledger/index.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import { time } from "./github-waits.js";
import {
  countsBefore,
  tokenSession,
  type MergedTokensOptions,
} from "./merged-tokens.js";
import {
  DEFAULT_MERGED_TRAILING_DAYS,
  mergedIn,
  trailingBefore,
} from "./merged-span.js";
import type { Span } from "./scope.js";
import { tokenStageResolver } from "./stage-of.js";
import { STAGES, type Stage } from "./stages.js";

/** Tokens spent in each stage, every stage present, zero where a stage spent nothing. */
export type StageTokens = Record<Stage, number>;

/** One figure: per-stage tokens per merged change in a span, or insufficient when the span has too few merged changes. */
export type StageFigure =
  | {
      status: "ok";
      /** The merged changes in the span. */
      merged: number;
      /** Each stage's tokens over the merged changes, to four places. */
      perMerged: StageTokens;
    }
  | {
      status: "insufficient merged changes";
      merged: number;
      /** The minimum merged changes a span needs before its figure is read. */
      needed: number;
    };

export interface TokensByStagePerMergedChange {
  /** The trailing days the average covers, before the window (or before as-of when the window has no start). */
  trailingDays: number;
  /** The fewest merged changes a span needs before its figure is read. */
  minMergedChanges: number;
  current: StageFigure;
  /** The same figure over the trailing days; its perMerged is the trailing average by stage. */
  trailingAverage: StageFigure;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

const zeroStages = (): StageTokens =>
  Object.fromEntries(STAGES.map((stage) => [stage, 0])) as StageTokens;

/**
 * The stage each session spent in, from its latest reading: a session keeps the
 * stage its launch gave it, so the latest reading's stage is every reading's.
 */
function stageOfSessions(
  events: LedgerEvent[],
  stageOf: (event: LedgerEvent) => Stage,
): Map<string, Stage> {
  const latest = new Map<string, { at: number; stage: Stage }>();
  for (const event of events) {
    if (event.kind !== "token.usage" || event.tokens === undefined) {
      continue;
    }
    const session = tokenSession(event);
    const seen = latest.get(session);
    const at = time(event);
    if (seen === undefined || at >= seen.at) {
      latest.set(session, { at, stage: stageOf(event) });
    }
  }
  return new Map([...latest].map(([session, v]) => [session, v.stage]));
}

/** Tokens spent in the span, split by the stage of the session that spent them. */
function stageTokensIn(events: LedgerEvent[], span: Span): StageTokens {
  const stages = stageOfSessions(events, tokenStageResolver(events));
  const end = countsBefore(events, span[1]);
  const start = countsBefore(events, span[0]);
  const totals = zeroStages();
  for (const [session, tokens] of end) {
    const stage = stages.get(session);
    if (stage !== undefined) {
      totals[stage] += tokens - (start.get(session) ?? 0);
    }
  }
  return totals;
}

/** The per-stage figure for one span, insufficient below the minimum merged changes. */
function figureIn(
  events: LedgerEvent[],
  span: Span,
  minMergedChanges: number,
): StageFigure {
  const merged = mergedIn(events, span);
  if (merged < minMergedChanges) {
    return {
      status: "insufficient merged changes",
      merged,
      needed: minMergedChanges,
    };
  }
  const tokens = stageTokensIn(events, span);
  const perMerged = zeroStages();
  for (const stage of STAGES) {
    perMerged[stage] = round(tokens[stage] / merged);
  }
  return { status: "ok", merged, perMerged };
}

/** Tokens spent in each stage over the window: the window's share of every session's spend, by stage. */
export function tokensByStage(
  events: LedgerEvent[],
  window: Span,
): StageTokens {
  return stageTokensIn(events, window);
}

/**
 * Tokens per merged change in each stage over the window, with the same figure
 * over the trailing days before it. A span with too few merged changes gives no
 * value, never a zero.
 */
export function tokensByStagePerMergedChange(
  events: LedgerEvent[],
  window: Span,
  { trailingDays, minMergedChanges, asOf }: MergedTokensOptions,
): TokensByStagePerMergedChange {
  return {
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

/**
 * Tokens per merged change in each stage over the window, read against the minimum
 * merged changes the cost settings give (the placeholder when they leave it out).
 */
export function mergedChangeStageTokens(
  events: LedgerEvent[],
  window: Span,
  { asOf, cost = {} }: { asOf: Date; cost?: Partial<CostOptions> },
): TokensByStagePerMergedChange {
  return tokensByStagePerMergedChange(events, window, {
    trailingDays: DEFAULT_MERGED_TRAILING_DAYS,
    minMergedChanges: { ...DEFAULT_COST, ...cost }.minMergedChanges,
    asOf,
  });
}
