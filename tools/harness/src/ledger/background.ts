import type { LedgerEvent } from "./schema.js";

/**
 * Whether a background command is open on the pane at `at` (#854). A background
 * command outlives its turn, so a session.stop does not close it; it stays open
 * until the pane prints a RESULT line after the command started, or until the pane
 * has printed none, so the record cannot tell that the command has ended.
 */
export function hasOpenBackground(
  events: readonly LedgerEvent[],
  pane: string,
  at: number,
): boolean {
  let started: number | undefined;
  let finished: number | undefined;
  for (const event of events) {
    const when = Date.parse(event.occurredAt);
    if (event.pane !== pane || when > at) {
      continue;
    }
    if (event.kind === "tool.start" && event.background === true) {
      started = Math.max(started ?? when, when);
    } else if (event.kind === "pane.finished") {
      finished = Math.max(finished ?? when, when);
    }
  }
  return (
    started !== undefined && (finished === undefined || started > finished)
  );
}
