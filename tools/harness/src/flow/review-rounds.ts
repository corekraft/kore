// The failed review rounds and the review coverage per writer tier (#1050, spec #1024): each priced
// tier's merged changes, its failed review rounds beside its rework (#1009), and the share of its
// merged changes with a principles-review verdict for their head, with an unlinked row for the pull
// requests that join to no tier. A pull request joins to the tier of its linked writer
// (writer-join.ts); a change with no link is never given a tier by inference. The figures are counts
// and rates only: no verdict or send-back text is read into them.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import {
  headNamings,
  isReviewedAtHead,
  sendBackHeadOf,
  verdictsOf,
} from "./review-heads.js";
import { inWindow, type Span } from "./scope.js";
import { linkedAgents, pricedLaunches, tierOfLinked } from "./writer-join.js";
import { reworkSendsIn } from "./writer-tier-figures.js";

/**
 * One writer tier's row. A failed review round is a send-back, or a principles-review verdict with
 * one or more violations, for a head; it is reported beside rework and is never rework.
 */
export interface TierReviewRounds {
  /** The merged changes in the span joined to this tier. */
  mergedChanges: number;
  /** Failed review rounds recorded in the span on this tier's pull requests, each PR head once. */
  failedReviewRounds: number;
  /** Failed review rounds over the tier's merged changes, to four places; null with none joined. */
  failedReviewRoundsPerMergedChange: number | null;
  /** Rework sent to the tier's writer panes in the span (#1009), the same count sendBackTiers carries. */
  rework: number;
  /** The rework over the tier's merged changes, to four places; null with none joined. */
  reworkPerMergedChange: number | null;
  /** The merged changes in the span with a principles-review verdict for their head. */
  reviewedChanges: number;
  /** The reviewed changes over the merged changes, to four places; null with none joined. */
  reviewCoverage: number | null;
}

/** The row of pull requests that join to no tier; it has no rework, since a send to a pane with no writer tier is not read. */
export interface UnlinkedReviewRounds {
  mergedChanges: number;
  failedReviewRounds: number;
  reviewedChanges: number;
  reviewCoverage: number | null;
}

/** The flow report's failed review rounds and review coverage per writer tier; the JSON carries these exactly. */
export interface ReviewRounds {
  tiers: Record<string, TierReviewRounds>;
  unlinked: UnlinkedReviewRounds;
}

/** The review rounds with nothing in the span: no tier row and an empty unlinked row, coverage not read. */
export const NO_REVIEW_ROUNDS: ReviewRounds = {
  tiers: {},
  unlinked: {
    mergedChanges: 0,
    failedReviewRounds: 0,
    reviewedChanges: 0,
    reviewCoverage: null,
  },
};

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const rate = (count: number, of: number) =>
  of === 0 ? null : round(count / of);

/** A failed round's PR and its key: one per PR head, and a send-back that names no PR or head counts on its own. */
interface FailedRound {
  number: number | undefined;
  key: string;
}

/** The failed review rounds recorded in the span, each PR head once. */
function failedRoundsIn(events: LedgerEvent[], span: Span): FailedRound[] {
  const seen = new Map<string, FailedRound>();
  const add = (
    number: number | undefined,
    head: string | undefined,
    id: string,
  ) => {
    const key =
      number === undefined || head === undefined
        ? `event:${id}`
        : `${number}\0${head}`;
    seen.set(key, { number, key });
  };
  for (const v of verdictsOf(events)) {
    if ((v.findings ?? 0) > 0 && inWindow(span, v.at)) {
      add(v.number, v.head, `${v.number}\0${v.head}`);
    }
  }
  for (const e of events) {
    if (e.kind === "send-back" && inWindow(span, time(e))) {
      add(e.number, sendBackHeadOf(e), e.id);
    }
  }
  return [...seen.values()];
}

/**
 * The failed review rounds, the rework and the review coverage per tier over the span, read from the
 * given tiers in their order. A round and a merged change join to the tier their pull request's
 * writer joins to; one that joins to none, or has no pull request number, is in the unlinked row.
 * Merged changes are placed by their merge time and rounds by the time each was recorded.
 */
export function reviewRoundsIn(
  events: LedgerEvent[],
  span: Span,
  tiers: string[],
): ReviewRounds {
  const launches = pricedLaunches(events);
  const agents = linkedAgents(events);
  const tierOf = (number: number | undefined): string | undefined => {
    const agent = number === undefined ? undefined : agents.get(number);
    return agent === undefined ? undefined : tierOfLinked(launches, agent);
  };
  const failed = failedRoundsIn(events, span);
  const verdicts = verdictsOf(events);
  const namings = headNamings(events);
  const mergedChanges = events.flatMap((e) =>
    e.kind === "pr.merged" && e.number !== undefined && inWindow(span, time(e))
      ? [
          {
            number: e.number,
            reviewed: isReviewedAtHead(e.number, time(e), verdicts, namings),
          },
        ]
      : [],
  );
  const rework = reworkSendsIn(events, span);
  const rowOf = (tier: string | undefined) => {
    const merged = mergedChanges.filter((m) => tierOf(m.number) === tier);
    const reviewedChanges = merged.filter((m) => m.reviewed).length;
    return {
      mergedChanges: merged.length,
      failedReviewRounds: failed.filter((f) => tierOf(f.number) === tier)
        .length,
      reviewedChanges,
      reviewCoverage: rate(reviewedChanges, merged.length),
    };
  };
  return {
    tiers: Object.fromEntries(
      tiers.map((tier): [string, TierReviewRounds] => {
        const row = rowOf(tier);
        const reworked = rework.get(tier) ?? 0;
        return [
          tier,
          {
            mergedChanges: row.mergedChanges,
            failedReviewRounds: row.failedReviewRounds,
            failedReviewRoundsPerMergedChange: rate(
              row.failedReviewRounds,
              row.mergedChanges,
            ),
            rework: reworked,
            reworkPerMergedChange: rate(reworked, row.mergedChanges),
            reviewedChanges: row.reviewedChanges,
            reviewCoverage: row.reviewCoverage,
          },
        ];
      }),
    ),
    unlinked: rowOf(undefined),
  };
}
