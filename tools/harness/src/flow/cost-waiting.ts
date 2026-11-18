// Token cost beside waiting time (#1019, spec #997): the public surface. The figures are read per
// agent role, per merged pull request and per idea over the window, with writing by idea (#1093); the shapes live in
// cost-waiting-types.ts and each level's arithmetic in its own cost-waiting-*.ts file.

import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./scope.js";
import { agentRowsIn } from "./cost-waiting-agents.js";
import { ceilingSharesIn } from "./cost-waiting-ceiling-shares.js";
import { ideasWithWritingIn } from "./cost-waiting-ideas-writing.js";
import { mergedChangesIn } from "./cost-waiting-merged.js";
import type { CostWaiting, CostWaitingOptions } from "./cost-waiting-types.js";

export type * from "./cost-waiting-types.js";

/**
 * The window's figures for agent roles, ideas, merged pull requests and writing. A linked writer's
 * spend is in its pull request's idea; writing with no idea is in a named bucket (#1093).
 */
export function costWaitingIn(
  events: LedgerEvent[],
  window: Span,
  options: CostWaitingOptions,
): CostWaiting {
  const mergedChanges = mergedChangesIn(events, window, options);
  return {
    agents: agentRowsIn(events, window, options),
    ...ideasWithWritingIn(events, window, options),
    mergedChanges,
    ceilingShares: ceilingSharesIn(
      events,
      window,
      options,
      mergedChanges.changes,
    ),
  };
}
