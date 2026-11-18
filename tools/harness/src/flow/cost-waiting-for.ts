// The cost beside waiting figures read against the report's settings (#1019, #1048): the published
// prices, the cost settings' minimum, the config's ceiling and the as-of time.

import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./scope.js";
import { costWaitingIn, type CostWaiting } from "./cost-waiting.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import { MODEL_PRICES } from "./writer-prices.js";

export type { CostWaiting };

/** The cost settings and the config's ceiling a report reads its figures against (#1019). */
export interface CostWaitingFor {
  cost?: Partial<CostOptions>;
  weeklyTokenCeiling?: number | undefined;
  /** Where the per-agent shares' 7 days end when the window has no end (#1048). */
  asOf?: Date | undefined;
}

/** The figures read at the published prices, against the cost settings and the config's ceiling (#1019). */
export function costWaitingFor(
  events: LedgerEvent[],
  window: Span,
  options: CostWaitingFor,
): CostWaiting {
  return costWaitingIn(events, window, {
    prices: MODEL_PRICES,
    minimum: options.cost?.minMergedChanges ?? DEFAULT_COST.minMergedChanges,
    weeklyTokenCeiling: options.weeklyTokenCeiling,
    asOf: options.asOf,
  });
}
