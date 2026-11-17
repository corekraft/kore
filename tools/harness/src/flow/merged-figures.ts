// The per-merged-change figures the flow report names together: tokens (#829), and
// send-backs and lead time (#830), and tokens by stage (#831). Each is read over the
// window; the per-merged ones have a trailing average over the days before it.

import type { LedgerEvent } from "../ledger/index.js";
import type { CostOptions } from "./cost.js";
import {
  mergedChangeLeadTime,
  type LeadTimePerMergedChange,
} from "./merged-lead-time.js";
import {
  mergedChangeSendBacks,
  type SendBacksPerMergedChange,
} from "./merged-send-backs.js";
import {
  mergedChangeStageTokens,
  tokensByStage,
  type StageTokens,
  type TokensByStagePerMergedChange,
} from "./merged-stage-tokens.js";
import {
  mergedChangeTokens,
  type TokensPerMergedChange,
} from "./merged-tokens.js";
import { mergedChangeWriterCost, type WriterCost } from "./writer-cost.js";
import {
  mainSessionFigures,
  type MainSessionFigures,
  type Span,
} from "./main-session.js";

export interface MergedChangeFigures {
  /** Tokens per merged change over the window, with the trailing days before it as the average. */
  tokensPerMergedChange: TokensPerMergedChange;
  /** Send-backs per merged change over the window, with the trailing days before it as the average. */
  sendBacksPerMergedChange: SendBacksPerMergedChange;
  /** Median lead time per merged change over the window, from each PR's opening to its merge, with the trailing days as the average. */
  leadTimePerMergedChange: LeadTimePerMergedChange;
  /** Tokens spent in each stage over the window (#831). */
  tokensByStage: StageTokens;
  /** Tokens per merged change in each stage over the window, with the trailing days before it as the average (#831). */
  tokensByStagePerMergedChange: TokensByStagePerMergedChange;
  /** Writer tokens per merged change by tier, weighted by the pinned price table, with the trailing days as the average, beside follow-ups and the blocked share (#868). */
  writerCost: WriterCost;
  /** The main session's poll minutes, pane-result reads and signed sends, from the retro scans' events (#940); never in the owner digest. */
  mainSession: MainSessionFigures;
}

/** The per-merged-change figures over the window, read against the cost settings. */
export function mergedChangeFigures(
  events: LedgerEvent[],
  window: Span,
  options: { asOf: Date; cost?: Partial<CostOptions> },
): MergedChangeFigures {
  return {
    tokensPerMergedChange: mergedChangeTokens(events, window, options),
    sendBacksPerMergedChange: mergedChangeSendBacks(events, window, options),
    leadTimePerMergedChange: mergedChangeLeadTime(events, window, options),
    tokensByStage: tokensByStage(events, window),
    tokensByStagePerMergedChange: mergedChangeStageTokens(
      events,
      window,
      options,
    ),
    writerCost: mergedChangeWriterCost(events, window, options),
    mainSession: mainSessionFigures(events, window, options.cost),
  };
}
