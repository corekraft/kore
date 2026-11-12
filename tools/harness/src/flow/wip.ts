import type { Span } from "./intervals.js";

/** Ideas open in a stage at once, over the report's range. */
export interface Wip {
  /** The most ideas open in the stage at one moment. */
  peak: number;
  /** Idea-seconds open over the range's seconds: the time-weighted average. */
  average: number;
}

const roundAverage = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * Peak and time-weighted average of `spans`, one per idea open in a stage, over
 * `range`. A span ending where another starts does not overlap it.
 */
export function wipOf(spans: Span[], range: Span): Wip {
  const edges = spans
    .filter(([from, to]) => to > from)
    .flatMap(([from, to]): [number, number][] => [
      [from, 1],
      [to, -1],
    ])
    // At the same instant a close sorts before an open.
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0;
  let peak = 0;
  let ideaMs = 0;
  let last = range[0];
  for (const [time, step] of edges) {
    ideaMs += open * (time - last);
    last = time;
    open += step;
    peak = Math.max(peak, open);
  }
  const length = range[1] - range[0];
  return { peak, average: length > 0 ? roundAverage(ideaMs / length) : 0 };
}

/** The shortest span holding `span` and `into`; one idea's open interval in a stage. */
export const widen = (into: Span | undefined, span: Span): Span =>
  into === undefined
    ? [span[0], span[1]]
    : [Math.min(into[0], span[0]), Math.max(into[1], span[1])];

/** The middle value, or the mean of the middle two; null for none. */
export function median(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return null;
  }
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
