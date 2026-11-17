// The time owner questions wait on a person (ADR 0120). A question waits from its owner.asked
// event until the same pane or session next acts, or until the range's end or the as-of time
// when it never does. Waiting on a person is reported apart from every stage's waiting.
import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

export interface WaitingOnPerson {
  /** owner.asked events in the range. */
  questions: number;
  /** Questions the same pane or session acted after, before the range's end. */
  answered: number;
  /** Questions with no such action before the range's end or the as-of time. */
  unanswered: number;
  /** Seconds the questions waited on a person, summed and whole. */
  waitingSeconds: number;
  /** waitingSeconds over questions, whole seconds; null when no question was asked. */
  perQuestionSeconds: number | null;
}

/** A pane when one wrote the event, else the session; undefined when neither did. */
const actorOf = (e: LedgerEvent): string | undefined => e.pane ?? e.session;

/** The waits of the owner.asked questions in the range, from the events of their panes and sessions. */
export function waitingOnPerson(
  events: LedgerEvent[],
  window: Span,
  asOf: Date,
): WaitingOnPerson {
  const clipEnd = Math.min(window[1], asOf.getTime());
  const byActor = new Map<string, LedgerEvent[]>();
  for (const event of events) {
    const actor = actorOf(event);
    if (actor !== undefined) {
      byActor.set(actor, [...(byActor.get(actor) ?? []), event]);
    }
  }
  const questions = events.filter(
    (e) => e.kind === "owner.asked" && inWindow(window, time(e)),
  );
  let answered = 0;
  let totalMs = 0;
  for (const question of questions) {
    const from = time(question);
    const actor = actorOf(question);
    const next = (actor === undefined ? [] : (byActor.get(actor) ?? []))
      .map(time)
      .filter((at) => at > from)
      .sort((a, b) => a - b)[0];
    const isAnswered = next !== undefined && next <= clipEnd;
    answered += isAnswered ? 1 : 0;
    totalMs += Math.max(0, (isAnswered ? next : clipEnd) - from);
  }
  const count = questions.length;
  return {
    questions: count,
    answered,
    unanswered: count - answered,
    waitingSeconds: Math.round(totalMs / 1000),
    perQuestionSeconds: count === 0 ? null : Math.round(totalMs / 1000 / count),
  };
}
