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
  "mainSession",
  "handovers",
  "compactions",
  "judgmentContexts",
  "tierShares",
  "unstampedSpawns",
  "finishDetection",
  "stalledPanes",
  "skippedLines",
];

/**
 * The keys of `flow report --json --split-at TIME`, in report order: KEYS with `sendBackTiersSplit`
 * after `sendBackTiers`. A report without --split-at carries KEYS exactly (#1047).
 */
export const SPLIT_KEYS = KEYS.flatMap((key) =>
  key === "sendBackTiers" ? [key, "sendBackTiersSplit"] : [key],
);

/** The keys of `sendBackTiersSplit`: the split date, then the tier figures of each side (#1047). */
export const SPLIT_SIDE_KEYS = ["at", "before", "after"];

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
