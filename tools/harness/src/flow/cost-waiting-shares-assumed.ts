// The main session's token totals with no recorded model, read in plan-weighted tokens (#1048):
// the assumed part of the orchestrating spend, priced at the assumed main-session model. It is a
// floor, as the token.usage totals hold input, output and cache creation only.

import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./scope.js";
import { planPricesOf } from "./plan-prices.js";
import { orchestrateDollarsIn } from "./writer-orchestrate.js";

/** The assumed part of the main session's spend in a span. */
export interface AssumedPart {
  /** The sessions whose token totals grew in the span with no reading. */
  sessions: number;
  /** Their plan-weighted tokens at the assumed model's input weight. */
  plan: number;
  /** The models the plan does not weight, named, never read as zero. */
  unweighted: string[];
}

/** The assumed part in the span, or undefined when no unread token totals grew in it. */
export function assumedPartIn(
  events: LedgerEvent[],
  span: Span,
): AssumedPart | undefined {
  const read = orchestrateDollarsIn(events, span, planPricesOf(events));
  if (read.assumedTokens === 0) {
    return undefined;
  }
  return {
    sessions: read.assumedSessions,
    plan: read.assumed,
    unweighted: read.unpriced,
  };
}
