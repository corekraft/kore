// The owner's queue of reserved questions (ADR 0120): every decision.routed to the owner, read from
// the ledger, with the tick's decision.blocking marks. A question is listed as open once routed;
// closing one waits for the owner's untagged reply (#862).
import type { LedgerEvent } from "../ledger/index.js";

export interface OwnerQuestion {
  /** The idea's number, as its record writes it. */
  readonly idea: string;
  /** The category the question was routed under. */
  readonly category: string;
  /** When the question was routed to the owner. */
  readonly since: string;
  /** True when the tick marked the idea blocked after the question was asked. */
  readonly blocking: boolean;
}

/** The time a mark or question happened, read for ordering. */
const at = (event: LedgerEvent): number => Date.parse(event.occurredAt);

/**
 * The open owner questions, blocking first and then oldest first. A blocking mark counts only
 * when the tick wrote it after the question was routed, so an old mark never blocks a new question.
 */
export function openOwnerQuestions(
  events: readonly LedgerEvent[],
): OwnerQuestion[] {
  const marks = events.filter((event) => event.kind === "decision.blocking");
  const questions = events
    .filter(
      (event) =>
        event.kind === "decision.routed" &&
        event.route === "owner" &&
        event.idea !== undefined,
    )
    .map((event): OwnerQuestion => {
      const idea = event.idea as string;
      const blocking = marks.some(
        (mark) => mark.idea === idea && at(mark) >= at(event),
      );
      return {
        idea,
        category: event.label ?? "unclassified",
        since: event.occurredAt,
        blocking,
      };
    });
  return questions.sort(
    (a, b) =>
      Number(b.blocking) - Number(a.blocking) ||
      Date.parse(a.since) - Date.parse(b.since),
  );
}
