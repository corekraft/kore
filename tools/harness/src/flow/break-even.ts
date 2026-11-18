// The Haiku-Sonnet break-even in the flow report (#1051, spec #1024): the rework rounds per merged
// change at which Haiku's median all-in cost per merged change reaches Sonnet's. The cost of one
// rework round is read from Haiku's own merged changes (#1008's all-in dollars per change, joined
// to a tier by its first launch): the median of the changes with exactly one rework round less the
// median of those with none. The break-even is Sonnet's median less Haiku's no-rework median, over
// that cost of one round. Rework is #1009's: a send to a writer pane after a judge send-back
// (change-rework.ts). The figure names no winner. A tier below the minimum merged changes, an
// unpriced model, or a median that cannot be read is reported as such and never as a zero.

import type { LedgerEvent } from "../ledger/index.js";
import { reworkByChange } from "./change-rework.js";
import type { Span } from "./scope.js";
import { median } from "./wip.js";
import {
  tierDollarsIn,
  writerDollarsIn,
  type InsufficientPrices,
} from "./writer-attribution.js";
import { MODEL_PRICES } from "./writer-prices.js";

/** The tier each side of the break-even is read from: the arms' first-launch tiers (writer-arms.ts). */
const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";

/** Merged changes of a group and the median of their all-in dollars; null with none. */
export interface CostGroup {
  changes: number;
  median: number | null;
}

/** What the break-even is read from, shown with it so the medians behind it are never hidden. */
export interface BreakEvenFigures {
  /** The fewest merged changes each tier needs before the break-even is read. */
  needed: number;
  haiku: {
    tier: string;
    /** The merged changes in the span joined to Haiku. */
    mergedChanges: number;
    /** Haiku's merged changes with no rework send, and the median of their all-in dollars. */
    noRework: CostGroup;
    /** Haiku's merged changes with exactly one rework send, and the median of their all-in dollars. */
    oneRound: CostGroup;
  };
  sonnet: {
    tier: string;
    mergedChanges: number;
    /** The median of the all-in dollars of Sonnet's merged changes. */
    median: number;
  };
}

export type BreakEven =
  | {
      status: "ok";
      needed: number;
      haiku: BreakEvenFigures["haiku"];
      sonnet: BreakEvenFigures["sonnet"];
      /** The median one rework round adds to Haiku's all-in dollars per merged change. */
      costPerReworkRound: number;
      /** The rework rounds per merged change at which Haiku's median reaches Sonnet's. */
      reworkRoundsPerMergedChange: number;
    }
  | ({ status: "not read"; reason: string } & BreakEvenFigures)
  | {
      status: "insufficient merged changes";
      needed: number;
      haiku: { tier: string; mergedChanges: number };
      sonnet: { tier: string; mergedChanges: number };
    }
  | InsufficientPrices;

/** The break-even with no merged change in either tier: below the minimum, not read. */
export const NO_BREAK_EVEN: BreakEven = {
  status: "insufficient merged changes",
  needed: 5,
  haiku: { tier: HAIKU, mergedChanges: 0 },
  sonnet: { tier: SONNET, mergedChanges: 0 },
};

const round = (value: number) => Math.round(value * 10_000) / 10_000;

const group = (totals: number[]): CostGroup => {
  const middle = median(totals);
  return {
    changes: totals.length,
    median: middle === null ? null : round(middle),
  };
};

/**
 * The break-even over the span, read against the minimum merged changes each tier needs. Each
 * merged change's all-in dollars are its writer and reviewer dollars and its equal share of the
 * judge and orchestrating spend, as the tier medians of writerCost read them.
 */
export function breakEvenIn(
  events: LedgerEvent[],
  span: Span,
  needed: number,
): BreakEven {
  const dollars = writerDollarsIn(events, span, MODEL_PRICES);
  const haikus = dollars.changes.filter((c) => c.tier === HAIKU);
  const sonnets = dollars.changes.filter((c) => c.tier === SONNET);
  const haikuDollars = tierDollarsIn(dollars, HAIKU);
  const sonnetDollars = tierDollarsIn(dollars, SONNET);
  const short = (n: number) => n < needed || n === 0;
  if (
    short(haikus.length) ||
    short(sonnets.length) ||
    haikuDollars === null ||
    sonnetDollars === null
  ) {
    return {
      status: "insufficient merged changes",
      needed,
      haiku: { tier: HAIKU, mergedChanges: haikus.length },
      sonnet: { tier: SONNET, mergedChanges: sonnets.length },
    };
  }
  const unpriced = [haikuDollars, sonnetDollars].flatMap((d) =>
    "status" in d ? d.models : [],
  );
  if ("status" in haikuDollars || "status" in sonnetDollars) {
    return {
      status: "insufficient prices",
      models: [...new Set(unpriced)].sort(),
    };
  }
  const shared =
    (dollars.shared.judge + dollars.shared.orchestrate) /
    dollars.changes.length;
  const rework = reworkByChange(events);
  const totalsWith = (rounds: number) =>
    haikus
      .filter((c) => (rework.get(c.number) ?? 0) === rounds)
      .map((c) => (c.writer ?? 0) + c.reviewer + shared);
  const noRework = group(totalsWith(0));
  const oneRound = group(totalsWith(1));
  const figures: BreakEvenFigures = {
    needed,
    haiku: { tier: HAIKU, mergedChanges: haikus.length, noRework, oneRound },
    sonnet: {
      tier: SONNET,
      mergedChanges: sonnets.length,
      median: sonnetDollars.median,
    },
  };
  const read = readBreakEven(noRework, oneRound, sonnetDollars.median);
  if ("reason" in read) {
    return { status: "not read", reason: read.reason, ...figures };
  }
  return {
    status: "ok",
    needed,
    haiku: figures.haiku,
    sonnet: figures.sonnet,
    ...read,
  };
}

/**
 * The cost of one rework round and the break-even from the three medians, or why they cannot be
 * read: a group with no change, a round that does not add cost (which would divide by zero), or
 * Haiku already dearer than Sonnet without rework (which would give a negative break-even).
 */
function readBreakEven(
  noRework: CostGroup,
  oneRound: CostGroup,
  sonnetMedian: number,
):
  | { costPerReworkRound: number; reworkRoundsPerMergedChange: number }
  | { reason: string } {
  if (noRework.median === null) {
    return { reason: "no Haiku change without rework" };
  }
  if (oneRound.median === null) {
    return { reason: "no Haiku change with one rework round" };
  }
  const costPerRound = oneRound.median - noRework.median;
  if (costPerRound <= 0) {
    return { reason: "a rework round does not add to Haiku's median cost" };
  }
  if (sonnetMedian < noRework.median) {
    return {
      reason: "Haiku's median without rework is above Sonnet's median",
    };
  }
  return {
    costPerReworkRound: round(costPerRound),
    reworkRoundsPerMergedChange: round(
      (sonnetMedian - noRework.median) / costPerRound,
    ),
  };
}
