// The flow report's send-backs per writer tier split at a date (#1047, spec #1024): the same figures
// as sendBackTiers, read over the time before the date and the time on or after it.

import type { LedgerEvent } from "../ledger/index.js";
import { splitFiguresAt, type SplitFigures } from "./date-split.js";
import { sendBackTiersIn, type SendBackTiers } from "./send-back-tiers.js";
import type { Span } from "./scope.js";
import { MODEL_PRICES } from "./writer-prices.js";

/** The report's `sendBackTiersSplit` key: present only when the report is given a split date. */
export interface SendBackTiersSplit {
  sendBackTiersSplit?: SplitFigures<SendBackTiers>;
}

/**
 * The tier figures over each side of the split date, under `sendBackTiersSplit`; nothing without a
 * date, so a report with no split carries exactly the keys it did before. A change merged at the
 * date is on the after side (date-split.ts). Merged changes are placed by their merge time and
 * send-backs and rework by the time each was recorded, as in the unsplit figures.
 */
export function sendBackTiersSplitIn(
  events: LedgerEvent[],
  span: Span,
  splitAt: Date | undefined,
): SendBackTiersSplit {
  if (splitAt === undefined) {
    return {};
  }
  return {
    sendBackTiersSplit: splitFiguresAt(span, splitAt, (side) =>
      sendBackTiersIn(events, side, Object.keys(MODEL_PRICES)),
    ),
  };
}
