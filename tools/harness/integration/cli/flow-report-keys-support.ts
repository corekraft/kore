/** The keys of `flow report --json`, in report order: the shape the CLI spec pins. */
export const KEYS = [
  "version",
  "asOf",
  "scope",
  "ideas",
  "minCompletedIdeas",
  "stages",
  "leadTime",
  "metrics",
  "rework",
  "friction",
  "retroProposalsDropped",
  "qualifierWarnings",
  "sendBackCategories",
  "bottleneck",
  "bottleneckNote",
  "unmappedEvents",
  "attribution",
  "guardBlocks",
  "guardBlocksByRule",
  "outcomes",
  "hostPressure",
  "ownerQuestions",
  "advisorQuality",
  "ownerRoutes",
  "waitingOnPerson",
  "reviewMisses",
  "costWaiting",
  "tokensPerMergedChange",
  "sendBacksPerMergedChange",
  "leadTimePerMergedChange",
  "tokensByStage",
  "tokensByStagePerMergedChange",
  "writerCost",
  "writerArms",
  "sendBackTiers",
  "reviewRounds",
  "violationsByRule",
  "breakEven",
  "mainSession",
  "handovers",
  "compactions",
  "mainSessionSetups",
  "judgmentContexts",
  "tierShares",
  "unstampedSpawns",
  "finishDetection",
  "stalledPanes",
  "skippedLines",
];

/** The key each figure's split reading follows, for `flow report --json --split-at TIME` (#1047, #1050, #1051). */
const SPLIT_AFTER: Record<string, string> = {
  sendBackTiers: "sendBackTiersSplit",
  reviewRounds: "reviewRoundsSplit",
  violationsByRule: "violationsByRuleSplit",
  breakEven: "breakEvenSplit",
};

/**
 * The keys of `flow report --json --split-at TIME`, in report order: KEYS with each figure's Split
 * key right after it (`sendBackTiersSplit`, `reviewRoundsSplit`, `violationsByRuleSplit` and
 * `breakEvenSplit`). A report without --split-at carries KEYS exactly (#1047, #1050, #1051).
 */
export const SPLIT_KEYS = KEYS.flatMap((key) => {
  const split = SPLIT_AFTER[key];
  return split === undefined ? [key] : [key, split];
});

/** The keys of `sendBackTiersSplit` and of `reviewRoundsSplit`: the split date, then the figures of each side (#1047, #1050). */
export const SPLIT_SIDE_KEYS = ["at", "before", "after"];

/** The keys of `reviewRounds` (and of each side of `reviewRoundsSplit`): the tier rows, then the unlinked row (#1050). */
export const REVIEW_ROUNDS_KEYS = ["tiers", "unlinked"];

/** The keys of one tier's row in `reviewRounds`, in report order: failed review rounds beside rework, then coverage (#1050). */
export const REVIEW_ROUNDS_TIER_KEYS = [
  "mergedChanges",
  "failedReviewRounds",
  "failedReviewRoundsPerMergedChange",
  "rework",
  "reworkPerMergedChange",
  "reviewedChanges",
  "reviewCoverage",
];

/** The keys of the unlinked row in `reviewRounds`: no rework, since a send to a pane with no writer tier is not read (#1050). */
export const REVIEW_ROUNDS_UNLINKED_KEYS = [
  "mergedChanges",
  "failedReviewRounds",
  "reviewedChanges",
  "reviewCoverage",
];

/** The keys of `violationsByRule` (and of each side of `violationsByRuleSplit`): the tier rows, then the unlinked row (#1051). */
export const VIOLATIONS_KEYS = ["tiers", "unlinked"];

/** The keys of one row of `violationsByRule`, tier or unlinked, in report order (#1051). */
export const VIOLATIONS_ROW_KEYS = [
  "failedVerdicts",
  "unlabelled",
  "citations",
  "rules",
];

/** The keys of `breakEven` when a tier has too few merged changes: no medians and no break-even (#1051). */
export const BREAK_EVEN_INSUFFICIENT_KEYS = [
  "status",
  "needed",
  "haiku",
  "sonnet",
];

/** The keys of `writerCost.current.orchestrate` once the span has enough merged changes, in report order (#1041). */
export const ORCHESTRATE_KEYS = [
  "weightedTokens",
  "model",
  "basis",
  "recordedModels",
  "assumedTokens",
  "dollars",
  "dollarsPerMergedChange",
];

/** The keys of `finishDetection`, in report order (#1090). */
export const FINISH_DETECTION_KEYS = [
  "windowSeconds",
  "results",
  "detected",
  "undetected",
  "neverNoticed",
  "late",
  "medianLagSeconds",
  "lagMinutes",
];

/** The keys of `finishDetection.lagMinutes`, in report order (#1090). */
export const LAG_MINUTES_KEYS = ["samples", "median", "p90"];

/** The keys of `stalledPanes`, in report order (#1090). */
export const STALLED_PANES_KEYS = [
  "silenceSeconds",
  "recorded",
  "silentSessions",
  "backgroundExcluded",
  "questionExcluded",
];

/** The keys of `costWaiting.writing`, in report order (#1093). */
export const WRITING_KEYS = [
  "attributed",
  "noIdea",
  "noPullRequest",
  "unjoinable",
  "share",
];

/** The keys of each `costWaiting.writing` bucket with priced models, in report order (#1093). */
export const WRITING_BUCKET_KEYS = ["sessions", "tokens", "dollars"];

/** The keys of a measured `costWaiting.writing.share` (#1093). */
export const WRITING_SHARE_KEYS = ["status", "share", "sessions"];

/** The keys of each `sendBackCategories` scope (perPrHead, perMergedChange) and each `sendBackTiers` row's `sendBacks`, in report order (#1094). */
export const SEND_BACK_COUNT_KEYS = [
  "byCategory",
  "legacy",
  "uncategorised",
  "otherThreshold",
  "categorised",
  "otherShare",
  "minCategorised",
  "otherReading",
  "otherOverThreshold",
];

/** The keys of `costWaiting`, in report order (#1048 adds ceilingShares last). */
export const COST_WAITING_KEYS = [
  "agents",
  "ideas",
  "writing",
  "mergedChanges",
  "ceilingShares",
];

/** The keys of `costWaiting.ceilingShares`, in report order (#1048). */
export const CEILING_SHARES_KEYS = [
  "ceiling",
  "agents",
  "mergedChanges",
  "ideas",
];

/** The keys of a level of `costWaiting.ceilingShares` that is not read, below the minimum count, in report order (#1048). */
export const SHARE_LEVEL_KEYS = ["label", "units", "needed", "status"];

/** The keys of the agent level, which adds the days of its rate and its rows (#1048). */
export const AGENT_SHARE_LEVEL_KEYS = [...SHARE_LEVEL_KEYS, "days", "rows"];

/** The keys of a merged-change or idea level, which adds its rows (#1048). */
export const UNIT_SHARE_LEVEL_KEYS = [...SHARE_LEVEL_KEYS, "rows"];
