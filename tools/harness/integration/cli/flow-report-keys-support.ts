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
