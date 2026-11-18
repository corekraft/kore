// Token cost beside waiting time (#1019, spec #997): the public surface. The figures are read per
// agent role, per merged pull request and per idea over the window, with writing by idea (#1093); the shapes live in
// cost-waiting-types.ts and each level's arithmetic in its own cost-waiting-*.ts file.

import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./scope.js";
import { agentRowsIn } from "./cost-waiting-agents.js";
import { ideasWithWritingIn } from "./cost-waiting-ideas-writing.js";
import { mergedChangesIn } from "./cost-waiting-merged.js";
import type { CostWaiting, CostWaitingOptions } from "./cost-waiting-types.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import { MODEL_PRICES } from "./writer-prices.js";

export type * from "./cost-waiting-types.js";

/** The cost settings and the config's ceiling a report reads its figures against (#1019). */
export interface CostWaitingFor {
  cost?: Partial<CostOptions>;
  weeklyTokenCeiling?: number | undefined;
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
  });
}

/**
 * The window's figures for agent roles, ideas, merged pull requests and writing. A linked writer's
 * spend is in its pull request's idea; writing with no idea is in a named bucket (#1093).
 */
export function costWaitingIn(
  events: LedgerEvent[],
  window: Span,
  options: CostWaitingOptions,
): CostWaiting {
  return {
    agents: agentRowsIn(events, window, options),
    ...ideasWithWritingIn(events, window, options),
    mergedChanges: mergedChangesIn(events, window, options),
  };
}
