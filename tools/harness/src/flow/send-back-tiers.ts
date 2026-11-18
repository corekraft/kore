// The send-backs by category per writer tier (#1045, spec #1024): each priced writer tier's merged
// changes, its judge send-backs by category and its rework (#1009), and an unlinked row for the
// merged changes and send-backs that join to no tier. A pull request joins to the tier of its
// linked writer (writer-join.ts); a change with no link is never given a tier by inference.

import {
  SEND_BACK_CATEGORIES,
  type LedgerEvent,
  type SendBackCategory,
} from "../ledger/index.js";
import {
  OTHER_SHARE_THRESHOLD,
  sendBackCategories,
  type CategoryCounts,
} from "./send-back-categories.js";
import { DEFAULT_MIN_CATEGORISED_SEND_BACKS } from "./cost.js";
import type { Span } from "./scope.js";
import {
  linkedAgents,
  mergedTierJoins,
  pricedLaunches,
  tierOfLinked,
} from "./writer-join.js";
import { reworkSendsIn } from "./writer-tier-figures.js";

/** One writer tier's row: its merged changes, its send-backs, and its rework with the rate it is read over. */
export interface TierSendBacks {
  /** The merged changes in the span joined to this tier. */
  mergedChanges: number;
  /** Judge send-backs in the span on this tier's pull requests, by category, each category once per PR head. */
  sendBacks: CategoryCounts;
  /** Rework sent to the tier's writer panes in the span (#1009). */
  rework: number;
  /** The rework over the tier's merged changes, rounded to four places; null with none joined. */
  reworkPerMergedChange: number | null;
}

/**
 * The row of changes that join to no tier: their merged changes, and the send-backs on pull requests
 * with no writer tier (a send-back with no pull request number is among them). It has no rework: a
 * send to a pane with no writer tier is not read.
 */
export interface UnlinkedSendBacks {
  mergedChanges: number;
  sendBacks: CategoryCounts;
}

/** The flow report's per-tier send-back figures, with the unlinked row; the JSON carries these exactly. */
export interface SendBackTiers {
  tiers: Record<string, TierSendBacks>;
  unlinked: UnlinkedSendBacks;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** A span with no send-back: every category zero, nothing uncategorised, and no share of other. */
const NO_SEND_BACK_COUNTS: CategoryCounts = {
  byCategory: Object.fromEntries(
    SEND_BACK_CATEGORIES.map((c) => [c, 0]),
  ) as Record<SendBackCategory, number>,
  legacy: 0,
  uncategorised: 0,
  otherThreshold: OTHER_SHARE_THRESHOLD,
  categorised: 0,
  otherShare: null,
  minCategorised: DEFAULT_MIN_CATEGORISED_SEND_BACKS,
  otherReading: "insufficient",
  otherOverThreshold: false,
};

/** The send-backs by category per writer tier with nothing in the span: no tier row and an empty unlinked row. */
export const NO_SEND_BACK_TIERS: SendBackTiers = {
  tiers: {},
  unlinked: { mergedChanges: 0, sendBacks: NO_SEND_BACK_COUNTS },
};

/**
 * The send-backs by category per tier over the span, read from the given tiers in their order. A
 * send-back joins to the tier its pull request's writer joins to; one that joins to none, or has no
 * pull request number, is in the unlinked row.
 */
export function sendBackTiersIn(
  events: LedgerEvent[],
  span: Span,
  tiers: string[],
  minCategorised: number,
): SendBackTiers {
  const launches = pricedLaunches(events);
  const agents = linkedAgents(events);
  const tierOfNumber = (number: number | undefined): string | undefined => {
    const agent = number === undefined ? undefined : agents.get(number);
    return agent === undefined ? undefined : tierOfLinked(launches, agent);
  };
  const sendBacks = events.filter((e) => e.kind === "send-back");
  const joins = mergedTierJoins(events, span);
  const rework = reworkSendsIn(events, span);
  const rows = Object.fromEntries(
    tiers.map((tier): [string, TierSendBacks] => {
      const mergedChanges = joins.joined.get(tier) ?? 0;
      const reworked = rework.get(tier) ?? 0;
      return [
        tier,
        {
          mergedChanges,
          sendBacks: sendBackCategories(
            sendBacks.filter((e) => tierOfNumber(e.number) === tier),
            span,
            minCategorised,
          ),
          rework: reworked,
          reworkPerMergedChange:
            mergedChanges === 0 ? null : round(reworked / mergedChanges),
        },
      ];
    }),
  );
  return {
    tiers: rows,
    unlinked: {
      mergedChanges: joins.unjoinable,
      sendBacks: sendBackCategories(
        sendBacks.filter((e) => tierOfNumber(e.number) === undefined),
        span,
        minCategorised,
      ),
    },
  };
}
