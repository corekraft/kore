import { buildReport } from "../flow/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { readMetric } from "./judge.js";

const DAY = 86_400_000;

export interface MeasureSpec {
  /** A dotted path into the flow report. */
  metric: string;
  changedAt: Date;
  windowDays: number;
}

export interface Measured {
  before: number | null;
  after: number | null;
}

/**
 * The metric over the equal-length window before the change and the window
 * after it, each from a flow report scoped to that window. A window the ledger
 * recorded nothing in has no figure, so an empty report never reads as zero.
 */
export function measureChange(
  events: LedgerEvent[],
  { metric, changedAt, windowDays }: MeasureSpec,
): Measured {
  const mid = changedAt.getTime();
  const span = windowDays * DAY;
  const figure = (from: number, to: number): number | null => {
    const has = events.some((e) => {
      const at = Date.parse(e.occurredAt);
      return at >= from && at < to;
    });
    if (!has) {
      return null;
    }
    const until = new Date(to);
    return readMetric(
      buildReport(events, {
        since: new Date(from),
        until,
        asOf: until,
        minCompletedIdeas: 1,
      }),
      metric,
    );
  };
  return { before: figure(mid - span, mid), after: figure(mid, mid + span) };
}
