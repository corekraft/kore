// The per-merged-change figures the flow report names together: tokens (#829), and
// send-backs and lead time (#830), and tokens by stage (#831). Each is read over the
// window; the per-merged ones have a trailing average over the days before it.

import type { LedgerEvent } from "../ledger/index.js";
import {
  costWaitingFor,
  type CostWaiting,
  type CostWaitingFor,
} from "./cost-waiting-for.js";
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
  judgmentContexts,
  mergedChangeTokens,
  type JudgmentContexts,
  type TokensPerMergedChange,
} from "./merged-tokens.js";
import { writerFiguresIn, type WriterFigures } from "./writer-figures.js";
import {
  compactionCount,
  handoverCount,
  mainSessionFigures,
  mainSessionSetups,
  type CompactionCount,
  type HandoverCount,
  type MainSessionFigures,
  type MainSessionSetups,
  type Span,
} from "./main-session.js";

/**
 * What the report reads its figures against from the harness config: the cost settings (trailing
 * window and thresholds; defaults apply to what is left out), the weekly
 * token ceiling (#1019) and the compaction cap in tokens (#1046). Each is absent when the config
 * sets none, which reads "not set" and never zero.
 */
export interface ReportSettings extends CostWaitingFor {
  compactionCap?: number | undefined;
}

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
  writerCost: WriterFigures["writerCost"];
  /** The Haiku and Sonnet arms over the window: all-in dollars per merged change, Haiku minus Sonnet, by label, with an interval (#1012). */
  writerArms: WriterFigures["writerArms"];
  /** Send-backs by category per writer tier, with the unlinked row, and each tier's rework (#1045). */
  sendBackTiers: WriterFigures["sendBackTiers"];
  /** The same send-backs per writer tier read before and from the split date; present only when the report is given one (#1047). */
  sendBackTiersSplit?: WriterFigures["sendBackTiersSplit"];
  /** Failed review rounds beside rework, and review coverage, per writer tier, with an unlinked row (#1050). */
  reviewRounds: WriterFigures["reviewRounds"];
  /** The same review rounds per writer tier read before and from the split date; present only when the report is given one (#1050). */
  reviewRoundsSplit?: WriterFigures["reviewRoundsSplit"];
  /** The cited rule labels of failing principles-review verdicts per writer tier, with an unlinked row (#1051). */
  violationsByRule: WriterFigures["violationsByRule"];
  /** The same violations per writer tier read before and from the split date; present only when the report is given one (#1051). */
  violationsByRuleSplit?: WriterFigures["violationsByRuleSplit"];
  /** The rework rounds per merged change at which Haiku's median all-in cost reaches Sonnet's, with the medians it uses (#1051). */
  breakEven: WriterFigures["breakEven"];
  /** The same break-even read before and from the split date; present only when the report is given one (#1051). */
  breakEvenSplit?: WriterFigures["breakEvenSplit"];
  /** The main session's poll minutes, pane-result reads and signed sends, from the retro scans' events (#940); never reported to the owner. */
  mainSession: MainSessionFigures;
  /** The main session's handovers by reason over the window, or why they are not read: no reason recorded, or too few merged changes (#1036). */
  handovers: HandoverCount;
  /** Compactions of sessions in the window, totalled and per session, or why they are not read: no session recorded (#1037). */
  compactions: CompactionCount;
  /** The setup of each main-session stretch (control, early compaction, Haiku), derived when the report reads, or not set / insufficient (#1046). */
  mainSessionSetups: MainSessionSetups;
  /** Judgment panes in the window, and the ones whose tokens went above the 60k context limit (ADR 0121, #876). */
  judgmentContexts: JudgmentContexts;
  /** Token cost beside waiting time per agent role, per merged pull request and per idea (#1019). */
  costWaiting: CostWaiting;
}

/** The per-merged-change figures over the window, read against the cost settings. */
export function mergedChangeFigures(
  events: LedgerEvent[],
  window: Span,
  options: {
    asOf: Date;
    windowEffort?: string;
    splitAt?: Date;
  } & ReportSettings,
): MergedChangeFigures {
  return {
    costWaiting: costWaitingFor(events, window, options),
    tokensPerMergedChange: mergedChangeTokens(events, window, options),
    sendBacksPerMergedChange: mergedChangeSendBacks(events, window, options),
    leadTimePerMergedChange: mergedChangeLeadTime(events, window, options),
    tokensByStage: tokensByStage(events, window),
    tokensByStagePerMergedChange: mergedChangeStageTokens(
      events,
      window,
      options,
    ),
    ...writerFiguresIn(events, window, options),
    mainSession: mainSessionFigures(events, window, options.cost),
    handovers: handoverCount(events, window, options.cost),
    compactions: compactionCount(events, window),
    mainSessionSetups: mainSessionSetups(events, window, options.compactionCap),
    judgmentContexts: judgmentContexts(events, window),
  };
}
