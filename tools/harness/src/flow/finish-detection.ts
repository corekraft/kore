// Finish detection over the window (#853, parent #818): a session.result the Stop hook
// recorded is detected when session wait records a pane.finished on the same pane within
// the threshold. The threshold is a placeholder until the owner sets it.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/** Placeholder threshold: the seconds either side of a result in which its pane.finished must fall. */
export const DETECTION_WINDOW_SECONDS = 300;

export interface FinishDetection {
  /** The threshold a finish must fall within, in seconds. */
  windowSeconds: number;
  /** session.result events in the window that name a pane. */
  results: number;
  /** Results with a pane.finished on their pane within the threshold, each finish detecting one result. */
  detected: number;
  /** Results with no such pane.finished: the detector missed them. */
  undetected: number;
  /** The median seconds from a result to the finish that detected it, 0 when the finish came first; null when none did. */
  medianLagSeconds: number | null;
}

interface Finish {
  pane: string;
  at: number;
  used: boolean;
}

const round = (value: number) => Math.round(value * 10) / 10;

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const middle =
    sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return round(middle);
}

/** The unused finish on the same pane nearest the result, within the threshold, or undefined. */
function nearest(
  finishes: Finish[],
  pane: string,
  at: number,
): Finish | undefined {
  const limit = DETECTION_WINDOW_SECONDS * 1000;
  return finishes
    .filter((f) => !f.used && f.pane === pane && Math.abs(f.at - at) <= limit)
    .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
}

/**
 * Pairs each session.result in the window with the pane.finished that detected it.
 * Results are paired in time order, one finish each, so a finish is never counted twice.
 */
export function finishDetection(
  events: LedgerEvent[],
  window: Span,
): FinishDetection {
  const finishes: Finish[] = events
    .filter(
      (e): e is LedgerEvent & { pane: string } =>
        e.kind === "pane.finished" && e.pane !== undefined,
    )
    .map((e) => ({ pane: e.pane, at: time(e), used: false }));
  const results = events
    .filter(
      (e): e is LedgerEvent & { pane: string } =>
        e.kind === "session.result" &&
        e.pane !== undefined &&
        inWindow(window, time(e)),
    )
    .sort((a, b) => time(a) - time(b));
  const lags: number[] = [];
  for (const result of results) {
    const at = time(result);
    const match = nearest(finishes, result.pane, at);
    if (match !== undefined) {
      match.used = true;
      lags.push(Math.max(0, match.at - at) / 1000);
    }
  }
  return {
    windowSeconds: DETECTION_WINDOW_SECONDS,
    results: results.length,
    detected: lags.length,
    undetected: results.length - lags.length,
    medianLagSeconds: median(lags),
  };
}
