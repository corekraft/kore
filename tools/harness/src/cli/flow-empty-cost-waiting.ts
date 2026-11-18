import type { FlowReport } from "../flow/index.js";

/**
 * The report fields a report with nothing in it holds beyond the shared fixture: the owner questions
 * and the cost beside waiting figures (#1019), each with nothing read.
 */
export const EMPTY_REPORT_FIELDS = {
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
  } as unknown as FlowReport["costWaiting"],
};
