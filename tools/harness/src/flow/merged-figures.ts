// The per-merged-change figures the flow report names together: tokens (#829), and
// send-backs and lead time (#830). Each is read over the window, with a trailing
// average over the days before it.

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
  mergedChangeTokens,
  type TokensPerMergedChange,
} from "./merged-tokens.js";
import type { Span } from "./scope.js";

export interface MergedChangeFigures {
  /** Tokens per merged change over the window, with the trailing days before it as the average. */
  tokensPerMergedChange: TokensPerMergedChange;
  /** Send-backs per merged change over the window, with the trailing days before it as the average. */
  sendBacksPerMergedChange: SendBacksPerMergedChange;
  /** Median lead time per merged change over the window, from each PR's opening to its merge, with the trailing days as the average. */
  leadTimePerMergedChange: LeadTimePerMergedChange;
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
  };
}
