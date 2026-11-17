import type { LedgerEvent } from "./schema.js";

const time = (event: LedgerEvent): number => Date.parse(event.occurredAt);

/**
 * Whether a pane waits on an open reserved question at `at` (ADR 0120, #854). The pane posted
 * the question as a decision.routed to the owner, with the pane and the issue number recorded
 * at post time, and no untagged owner reply (owner.replied) on that issue has come since. A
 * question with no issue number cannot be matched to a reply, so it exempts nothing: the stall
 * is reported. Reads only the decision.routed and owner.replied kinds, never token usage.
 */
export function hasOpenQuestion(
  events: readonly LedgerEvent[],
  pane: string,
  at: number,
): boolean {
  const posted = events.filter(
    (e) =>
      e.kind === "decision.routed" &&
      e.route === "owner" &&
      e.pane === pane &&
      e.number !== undefined &&
      time(e) <= at,
  );
  return posted.some(
    (question) =>
      !events.some(
        (e) =>
          e.kind === "owner.replied" &&
          e.number === question.number &&
          time(e) >= time(question) &&
          time(e) <= at,
      ),
  );
}
