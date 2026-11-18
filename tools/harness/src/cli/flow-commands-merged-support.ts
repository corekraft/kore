// Per-merged-change fixtures the flow report specs share (#1012): the arms and the lead time over a
// window with no merged change, each read as not read, never as a zero; and the review rounds per
// writer tier over a range with none (#1050).

import type { FlowReport, ReviewRounds } from "../flow/index.js";

const emptyArm = {
  tier: "claude-haiku-5-5",
  mergedChanges: 0,
  allInPerMergedChange: null,
  effort: {},
  blockedShare: null,
  sendBacksPerMergedChange: null,
  ownerMinutesPerMergedChange: null,
};
export const emptyWriterArms = {
  seed: 20261117,
  resamples: 2000,
  confidence: 0.95,
  minMergedChanges: 5,
  unlabelled: 0,
  windowEffort: { effort: "high", from: "setting" },
  excluded: { differentEffort: 0, missingEffort: 0, notRandomized: 0 },
  overall: {
    label: null,
    status: "insufficient merged changes",
    needed: 5,
    haiku: emptyArm,
    sonnet: { ...emptyArm, tier: "claude-sonnet-5-5" },
  },
  strata: [],
};

export const emptyLeadTimePerMergedChange = {
  trailingDays: 7,
  minMergedChanges: 5,
  current: {
    status: "insufficient merged changes",
    merged: 0,
    measured: 0,
    needed: 5,
  },
  trailingAverage: {
    status: "insufficient merged changes",
    merged: 0,
    measured: 0,
    needed: 5,
  },
};

/** The review rounds with no tier and no merged change in the range: coverage not read. */
export const emptyReviewRounds: ReviewRounds = {
  tiers: {},
  unlinked: {
    mergedChanges: 0,
    failedReviewRounds: 0,
    reviewedChanges: 0,
    reviewCoverage: null,
  },
};

/** The violations by rule and the break-even with no tier and no merged change in the range: below the minimum, not read. */
export const emptyViolationFigures: Pick<
  FlowReport,
  "violationsByRule" | "breakEven"
> = {
  violationsByRule: {
    tiers: {},
    unlinked: { failedVerdicts: 0, unlabelled: 0, citations: 0, rules: [] },
  },
  breakEven: {
    status: "insufficient merged changes",
    needed: 5,
    haiku: { tier: "claude-haiku-5-5", mergedChanges: 0 },
    sonnet: { tier: "claude-sonnet-5-5", mergedChanges: 0 },
  },
};

/** The text lines the empty violation figures print: the unlinked violations row and the break-even below the minimum. */
export const EMPTY_VIOLATION_LINES = [
  "Review violations by rule, unlinked row (no writer tier): 0 failing verdicts",
  "Haiku-Sonnet break-even not read: insufficient merged changes, claude-haiku-5-5 0 merged changes, claude-sonnet-5-5 0 merged changes, 5 needed in each tier; claude-haiku-5-5 rework per merged change not read",
];
