import type { LedgerEvent } from "../ledger/index.js";
import { APPROVAL_LABEL, type Stage } from "./stages.js";
import { uncovered, type Span } from "./intervals.js";
import type { Tally } from "./tally.js";

export const time = (event: LedgerEvent) => Date.parse(event.occurredAt);

export function firstTime(
  events: LedgerEvent[],
  match: (e: LedgerEvent) => boolean,
) {
  return events
    .filter(match)
    .map(time)
    .sort((a, b) => a - b)[0];
}

export type GithubWait = [stage: Stage, start: number, stop: number];

/** The GitHub waits: open issue until approval, open PR until merge, else to close or `asOf`. */
export function githubSpans(events: LedgerEvent[], asOf: number): GithubWait[] {
  const closed = firstTime(events, (e) => e.kind === "issue.closed");
  const waits: [Stage, number | undefined, number | undefined][] = [
    [
      "await approval",
      firstTime(events, (e) => e.kind === "issue.opened"),
      firstTime(
        events,
        (e) => e.kind === "issue.labelled" && e.label === APPROVAL_LABEL,
      ),
    ],
    [
      "merge",
      firstTime(events, (e) => e.kind === "pr.opened"),
      firstTime(events, (e) => e.kind === "pr.merged"),
    ],
  ];
  const spans: GithubWait[] = [];
  for (const [stage, start, end] of waits) {
    if (start !== undefined) {
      const stop = end ?? closed ?? asOf;
      if (stop > start) {
        spans.push([stage, start, stop]);
      }
    }
  }
  return spans;
}

/** Charges the GitHub waits, minus the time a pane was alive (`holes`), inside the window. */
export function githubWaits(tally: Tally, waits: GithubWait[], holes: Span[]) {
  const [lo, hi] = tally.window;
  for (const [stage, start, stop] of waits) {
    tally.present(stage, start, stop);
    const from = Math.max(start, lo);
    const to = Math.min(stop, hi);
    if (to > from) {
      tally.addMs(stage, "waitingMs", uncovered([from, to], holes));
    }
  }
}
