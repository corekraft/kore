// The figures the flow report reads from the principles-review violations and the cost of rework
// (#1051, spec #1024): the violations by cited rule per writer tier and the Haiku-Sonnet
// break-even, each with its split at a date (#1047). One entry for the writer figures to call.

import type { LedgerEvent } from "../ledger/index.js";
import { breakEvenIn, type BreakEven } from "./break-even.js";
import { splitFiguresAt, type SplitFigures } from "./date-split.js";
import type { Span } from "./scope.js";
import {
  violationsByRuleIn,
  type ViolationsByRule,
} from "./violation-rules.js";
import { MODEL_PRICES } from "./writer-prices.js";

export interface ReviewViolationFigures {
  /** The cited rule labels of failing verdicts, per writer tier (#1051). */
  violationsByRule: ViolationsByRule;
  /** The same violations read before and from the split date; present only with a split date. */
  violationsByRuleSplit?: SplitFigures<ViolationsByRule>;
  /** The rework rounds per merged change at which Haiku's median cost reaches Sonnet's (#1051). */
  breakEven: BreakEven;
  /** The same break-even read before and from the split date; present only with a split date. */
  breakEvenSplit?: SplitFigures<BreakEven>;
}

/**
 * The violations by rule and the break-even over the window, each followed by its reading on the
 * two sides of the split date when there is one; neither split key is present without a date. The
 * break-even is read against the minimum merged changes each tier needs.
 */
export function reviewViolationFiguresIn(
  events: LedgerEvent[],
  window: Span,
  splitAt: Date | undefined,
  minMergedChanges: number,
): ReviewViolationFigures {
  const tiers = Object.keys(MODEL_PRICES);
  const violations = (span: Span) => violationsByRuleIn(events, span, tiers);
  const rework = (span: Span) => breakEvenIn(events, span, minMergedChanges);
  return {
    violationsByRule: violations(window),
    ...(splitAt === undefined
      ? {}
      : { violationsByRuleSplit: splitFiguresAt(window, splitAt, violations) }),
    breakEven: rework(window),
    ...(splitAt === undefined
      ? {}
      : { breakEvenSplit: splitFiguresAt(window, splitAt, rework) }),
  };
}
