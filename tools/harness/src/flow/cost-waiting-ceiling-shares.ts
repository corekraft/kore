// The shares of the weekly token ceiling at each level (#1048, spec #1030): the public surface of
// the three share files. A per-agent share is a rate over the 7 days ending where the report's
// window ends (as-of when it has no end; the flow report always passes an as-of, and a direct caller
// that passes none gets the latest event); a merged-change
// and an idea share are sizes over one week's ceiling. The shapes are in cost-waiting-shares-types.ts.

import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./scope.js";
import { time } from "./github-waits.js";
import { agentSharesIn } from "./cost-waiting-shares-agents.js";
import { ideaSharesIn } from "./cost-waiting-shares-ideas.js";
import { mergedSharesIn } from "./cost-waiting-shares-merged.js";
import { RATE_DAYS, type CeilingShares } from "./cost-waiting-shares-types.js";
import type {
  CostWaitingOptions,
  MergedChangeFigure,
} from "./cost-waiting-types.js";

const DAY_MS = 86_400_000;

/** The 7 days a per-agent rate is read over, ending at the window's end, else as-of, else (a direct caller with none) the latest event. */
function trailingWeek(
  events: LedgerEvent[],
  window: Span,
  asOf: Date | undefined,
): Span {
  const end = Number.isFinite(window[1])
    ? window[1]
    : (asOf?.getTime() ?? Math.max(...events.map(time)));
  return [end - RATE_DAYS * DAY_MS, end];
}

/** The ceiling and the shares of it per agent, per merged change and per idea. */
export function ceilingSharesIn(
  events: LedgerEvent[],
  window: Span,
  options: CostWaitingOptions,
  changes: MergedChangeFigure[],
): CeilingShares {
  return {
    ceiling: options.weeklyTokenCeiling ?? "not set",
    agents: agentSharesIn(
      events,
      trailingWeek(events, window, options.asOf),
      options,
    ),
    mergedChanges: mergedSharesIn(events, window, options, changes),
    ideas: ideaSharesIn(events, window, options),
  };
}
