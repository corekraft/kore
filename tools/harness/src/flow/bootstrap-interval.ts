// A seeded percentile bootstrap interval for the difference between two arms' means (#1012, spec
// #998). Each resample draws each arm's values with replacement from the seeded generator, the
// first arm's values first, and takes the difference of the two resampled means. The interval is
// the nearest-rank percentiles of the sorted differences. The code states the interval; it never
// decides what counts as a difference (the owner's rule, recorded on the idea).

import { seededRandom } from "./seeded-random.js";

export interface IntervalOptions {
  /** The generator's seed: the same seed and values always give the same interval. */
  seed: number;
  /** How many resamples the bootstrap draws. */
  resamples: number;
  /** The interval's coverage, between zero and one, such as 0.95 for a 95 percent interval. */
  confidence: number;
}

export interface Interval {
  low: number;
  high: number;
}

const mean = (values: number[]) =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

/** The value a draw in [0, 1) picks from the values, with replacement. */
const pick = (values: number[], draw: number): number =>
  values[Math.floor(draw * values.length)] as number;

/**
 * The interval for the first arm's mean minus the second arm's mean. Both arms need at least one
 * value; the caller states that, and a stratum below its minimum never reaches this function.
 */
export function bootstrapDifferenceInterval(
  first: number[],
  second: number[],
  { seed, resamples, confidence }: IntervalOptions,
): Interval {
  if (!Number.isInteger(resamples) || resamples < 1) {
    throw new RangeError(
      `resamples must be a positive whole number, got ${resamples}`,
    );
  }
  const random = seededRandom(seed);
  const differences: number[] = [];
  for (let r = 0; r < resamples; r++) {
    const left = Array.from({ length: first.length }, () =>
      pick(first, random()),
    );
    const right = Array.from({ length: second.length }, () =>
      pick(second, random()),
    );
    differences.push(mean(left) - mean(right));
  }
  differences.sort((a, b) => a - b);
  const tail = (1 - confidence) / 2;
  const lowRank = Math.floor(tail * resamples);
  const highRank = Math.min(
    resamples - 1,
    Math.ceil((1 - tail) * resamples) - 1,
  );
  return {
    low: differences[lowRank] as number,
    high: differences[highRank] as number,
  };
}
