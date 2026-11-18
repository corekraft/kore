import type { FlowReport } from "../flow/index.js";

/**
 * The report fields a report with nothing in it holds beyond the shared fixture: the owner questions,
 * the cost beside waiting figures (#1019), and the finish detection and stalled panes (#1090), each
 * with nothing read.
 */
export const EMPTY_REPORT_FIELDS = {
  finishDetection: {
    windowSeconds: 300,
    results: 0,
    detected: 0,
    undetected: 0,
    neverNoticed: 0,
    late: 0,
    medianLagSeconds: null,
    lagMinutes: { samples: 0, median: null, p90: null },
  },
  stalledPanes: {
    silenceSeconds: 900,
    recorded: 0,
    silentSessions: 0,
    backgroundExcluded: 0,
    questionExcluded: 0,
  },
  ownerQuestions: {
    trailingDays: 7,
    questions: 0,
    merged: 0,
    perMerged: null,
    trailingAverage: null,
    worsened: false,
  },
  costWaiting: {
    agents: {},
    ideas: [],
    mergedChanges: {
      changes: [],
      status: "insufficient",
      joined: 0,
      needed: 5,
    },
    writing: {
      attributed: { sessions: 0, tokens: 0, dollars: 0 },
      noIdea: { sessions: 0, tokens: 0, dollars: 0 },
      noPullRequest: { sessions: 0, tokens: 0, dollars: 0 },
      unjoinable: 0,
      share: { status: "insufficient", sessions: 0, needed: 5 },
    },
  } as unknown as FlowReport["costWaiting"],
};
