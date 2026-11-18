// The merged-pull-request shares of the weekly ceiling (#1048, spec #1030): a change's total
// plan-weighted tokens (the all-in attribution of #1008, read at the plan prices) over one week's
// ceiling, with the span from its first writer launch to merge beside it. A size, not a rate. A
// change no writer launch joins has no share, never zero; a model with no plan weight is named.

import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./scope.js";
import { allInOf } from "./cost-waiting-merged.js";
import { levelOf, readingOf, type ShareUnit } from "./cost-waiting-shares.js";
import {
  SIZE_LABEL,
  type MergedChangeShares,
} from "./cost-waiting-shares-types.js";
import type {
  CostWaitingOptions,
  MergedChangeFigure,
} from "./cost-waiting-types.js";
import { planPricesOf } from "./plan-prices.js";
import { writerDollarsIn } from "./writer-attribution.js";

/** The shares of the merged changes in the window, from the changes the cost figures list. */
export function mergedSharesIn(
  events: LedgerEvent[],
  window: Span,
  options: CostWaitingOptions,
  figures: MergedChangeFigure[],
): MergedChangeShares {
  const plan = writerDollarsIn(events, window, planPricesOf(events));
  const shared = [
    ...plan.shared.judgeUnpriced,
    ...plan.shared.orchestrateUnpriced,
  ];
  const ceiling = options.weeklyTokenCeiling;
  const units: ShareUnit[] = [];
  const rows = figures.map((figure) => {
    const change = plan.changes.find((c) => c.number === figure.number);
    if (!figure.joined || change === undefined) {
      return { number: figure.number, share: null };
    }
    const unit: ShareUnit = {
      plan: allInOf(change, plan),
      unweighted: [...new Set([...change.unpriced, ...shared])],
      spanSeconds: figure.launchToMergeSeconds,
    };
    units.push(unit);
    return {
      number: figure.number,
      share: readingOf(SIZE_LABEL, unit, { ceiling }),
    };
  });
  return {
    ...levelOf(SIZE_LABEL, units, { ceiling, minimum: options.minimum }),
    rows,
  };
}
