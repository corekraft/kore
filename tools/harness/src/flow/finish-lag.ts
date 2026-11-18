// The median and 90th percentile of finish lags, in minutes (#1090). A lag is the seconds
// from a result to the finish paired with it. The figures are reported readings: they say
// how late a finish was recorded, never how long a merge waited.

/** The lags of detected and late finishes, in minutes; median and p90 are null when no finish had a lag. */
export interface FinishLag {
  /** Finishes with a lag, the count the median and p90 are taken over. */
  samples: number;
  /** The median lag in minutes, the mean of the two middle lags when the count is even; null with none. */
  median: number | null;
  /** The nearest-rank 90th percentile lag in minutes; null with none. */
  p90: number | null;
}

const minutes = (seconds: number) => Math.round((seconds / 60) * 100) / 100;

/** The median of sorted values, which must not be empty. */
function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** The nearest-rank percentile: the value at rank ceil(percent * n / 100) of sorted values, which must not be empty. */
function nearestRank(sorted: readonly number[], percent: number): number {
  const rank = Math.ceil((percent * sorted.length) / 100);
  return sorted[rank - 1] as number;
}

/** The median and 90th percentile, in minutes, of lags given in seconds. */
export function finishLag(lagSeconds: readonly number[]): FinishLag {
  if (lagSeconds.length === 0) {
    return { samples: 0, median: null, p90: null };
  }
  const sorted = [...lagSeconds].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    median: minutes(median(sorted)),
    p90: minutes(nearestRank(sorted, 90)),
  };
}
