// Per-merged-change fixtures the flow report specs share (#1012): the arms and the lead time over a
// window with no merged change, each read as not read, never as a zero.

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
