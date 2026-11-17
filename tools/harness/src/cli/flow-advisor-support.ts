// Report fixtures for the advisor figures (ADR 0120, #862), beside the flow report support that
// spreads them. Only the flow command specs use them, so they stay here (ADR 0098).
import type { FlowReport } from "../flow/index.js";

type AdvisorFields = Pick<
  FlowReport,
  "advisorQuality" | "ownerRoutes" | "waitingOnPerson"
>;

/** An empty range: no decision, no route and no question. */
export const EMPTY_ADVISOR: AdvisorFields = {
  advisorQuality: {
    made: 0,
    overturned: 0,
    perMade: null,
    refutingShare: 0.07,
    refuted: false,
  },
  ownerRoutes: {
    advisor: 0,
    owner: 0,
    bySignal: {
      "reserved-category": 0,
      matched: 0,
      "advisor-files": 0,
      escalated: 0,
      unclassifiable: 0,
    },
  },
  waitingOnPerson: {
    questions: 0,
    answered: 0,
    unanswered: 0,
    waitingSeconds: 0,
    perQuestionSeconds: null,
  },
};

/** A range with a refuted advisor, routed questions and a question that waited. */
export const POPULATED_ADVISOR: AdvisorFields = {
  advisorQuality: {
    made: 10,
    overturned: 1,
    perMade: 0.1,
    refutingShare: 0.07,
    refuted: true,
  },
  ownerRoutes: {
    advisor: 4,
    owner: 3,
    bySignal: {
      "reserved-category": 0,
      matched: 2,
      "advisor-files": 0,
      escalated: 1,
      unclassifiable: 0,
    },
  },
  waitingOnPerson: {
    questions: 2,
    answered: 1,
    unanswered: 1,
    waitingSeconds: 920,
    perQuestionSeconds: 460,
  },
};
