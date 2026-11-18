// The per-idea shares of the weekly ceiling (#1048, spec #1030): an idea's total plan-weighted
// tokens (its stamped sessions and the writers whose pull request carries it, read at the plan
// prices) over one week's ceiling, with the span from its first event to its last beside it. A
// size, not a rate. A model with no plan weight is named, never read as zero.

import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./scope.js";
import { ideasWithWritingIn } from "./cost-waiting-ideas-writing.js";
import { levelOf, readingOf, type ShareUnit } from "./cost-waiting-shares.js";
import { ideaSpanSeconds } from "./cost-waiting-shares-span.js";
import { SIZE_LABEL, type IdeaShares } from "./cost-waiting-shares-types.js";
import type { CostWaitingOptions } from "./cost-waiting-types.js";
import { planPricesOf } from "./plan-prices.js";

/** The shares of the ideas over the window, each idea once, in idea order. */
export function ideaSharesIn(
  events: LedgerEvent[],
  window: Span,
  options: CostWaitingOptions,
): IdeaShares {
  const planned = { ...options, prices: planPricesOf(events) };
  const ceiling = options.weeklyTokenCeiling;
  const units = ideasWithWritingIn(events, window, planned).ideas.map(
    (row) => ({
      idea: row.idea,
      unit: {
        plan: row.dollars ?? 0,
        unweighted: row.unpricedModels ?? [],
        spanSeconds: ideaSpanSeconds(events, row.idea),
      } satisfies ShareUnit,
    }),
  );
  return {
    ...levelOf(
      SIZE_LABEL,
      units.map(({ unit }) => unit),
      { ceiling, minimum: options.minimum },
    ),
    rows: units.map(({ idea, unit }) => ({
      idea,
      share: readingOf(SIZE_LABEL, unit, { ceiling }),
    })),
  };
}
