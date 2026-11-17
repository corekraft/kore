// The figures about owner questions and the advisor (#859, #862; ADR 0120), computed together
// from the named events and the window, so the flow report's builder names one call for them.
import type { LedgerEvent } from "../ledger/index.js";
import { advisorQuality, type AdvisorQuality } from "./advisor-quality.js";
import {
  DEFAULT_QUESTION_DAYS,
  ownerQuestions,
  type OwnerQuestions,
} from "./owner-questions.js";
import { ownerRoutes, type OwnerRoutes } from "./owner-routes.js";
import { waitingOnPerson, type WaitingOnPerson } from "./owner-wait.js";
import type { Span } from "./scope.js";

export interface QuestionFigures {
  /** Owner questions per merged change over the window, with the trailing days before it (#859). */
  ownerQuestions: OwnerQuestions;
  /** Decisions the owner overturned over decisions made, against the refuting share (ADR 0120, #862). */
  advisorQuality: AdvisorQuality;
  /** Questions the router sent to the owner, per signal, and to the advisor (ADR 0120, #862). */
  ownerRoutes: OwnerRoutes;
  /** Seconds questions waited on a person, apart from every stage's waiting (ADR 0120, #862). */
  waitingOnPerson: WaitingOnPerson;
}

/** The question and advisor figures over the window; the owner questions' trailing days end at the window's start. */
export function questionFigures(
  events: LedgerEvent[],
  window: Span,
  asOf: Date,
): QuestionFigures {
  return {
    ownerQuestions: ownerQuestions(events, window, {
      trailingDays: DEFAULT_QUESTION_DAYS,
      asOf,
    }),
    advisorQuality: advisorQuality(events, window),
    ownerRoutes: ownerRoutes(events, window),
    waitingOnPerson: waitingOnPerson(events, window, asOf),
  };
}
