// Splits the undetected results into never noticed and late (#1090). A result is never
// noticed when no pane.finished was ever recorded on its pane. Otherwise it is late: a
// finish exists on its pane, outside the detection window or already used by an earlier
// result. The two counts sum to the undetected count. A late result takes the nearest
// unused finish on its pane, at any distance, so its lag is read; one finish serves one
// result.

/** A session.result that named a pane and that no finish detected within the window. */
export interface PaneResult {
  pane: string;
  /** The result's time in milliseconds. */
  at: number;
}

/** A pane.finished on a pane; `used` is true once the detection pass paired it. */
export interface PaneFinish {
  pane: string;
  /** The finish's time in milliseconds. */
  at: number;
  used: boolean;
}

export interface UndetectedSplit {
  /** Results whose pane never had a pane.finished recorded. */
  neverNoticed: number;
  /** Results whose pane had a pane.finished recorded, outside the window or already used. */
  late: number;
  /** Seconds from each late result to the finish it takes, 0 when the finish came first; a late result with no unused finish has no lag. */
  lagSeconds: number[];
}

/** The unused finish on the result's pane nearest the result, at any distance, or undefined. */
function nearestUnused(
  available: readonly PaneFinish[],
  result: PaneResult,
): PaneFinish | undefined {
  return available
    .filter((f) => !f.used && f.pane === result.pane)
    .sort((a, b) => Math.abs(a.at - result.at) - Math.abs(b.at - result.at))[0];
}

/**
 * Classifies each undetected result in time order, so an earlier result takes a finish
 * before a later one. The finishes passed in are not changed.
 */
export function splitUndetected(
  undetected: readonly PaneResult[],
  finishes: readonly PaneFinish[],
): UndetectedSplit {
  const panesWithFinish = new Set(finishes.map((f) => f.pane));
  const available = finishes.map((f) => ({ ...f }));
  const split: UndetectedSplit = { neverNoticed: 0, late: 0, lagSeconds: [] };
  for (const result of [...undetected].sort((a, b) => a.at - b.at)) {
    if (!panesWithFinish.has(result.pane)) {
      split.neverNoticed += 1;
      continue;
    }
    split.late += 1;
    const match = nearestUnused(available, result);
    if (match !== undefined) {
      match.used = true;
      split.lagSeconds.push(Math.max(0, match.at - result.at) / 1000);
    }
  }
  return split;
}
