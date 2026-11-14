// Docs: infra/plans/2-implementation.md#step-7-bootstrap-registry-image-trust-controllers-and-crd-ownership
//
// The arithmetic of the footprint measurement: a run's median and peak per
// metric, the VM headroom they leave, and the baseline across runs. The spread
// has plan 13's definition: the gap between run medians as a percentage of the
// baseline.

export interface FootprintSample {
  cpuMillicores: number;
  memoryMiB: number;
  /** macOS swap in use on the host. */
  swapMiB: number;
  /** The host 1-minute load average. */
  loadAverage: number;
}

export type FootprintMetric = keyof FootprintSample;

export const footprintMetrics: readonly FootprintMetric[] = [
  "cpuMillicores",
  "memoryMiB",
  "swapMiB",
  "loadAverage",
];

export interface MedianAndPeak {
  median: number;
  max: number;
}

/** The share of the Docker VM's memory left free, in percent. */
export interface Headroom {
  atMedian: number;
  atPeak: number;
}

export interface FootprintSummary {
  summary: Record<FootprintMetric, MedianAndPeak>;
  headroomPercent: Headroom;
}

export interface FootprintBaseline {
  medians: Record<FootprintMetric, number>;
  headroomPercent: Headroom;
  spreadPercent: Record<FootprintMetric, number>;
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : mean([sorted[middle - 1] ?? 0, sorted[middle] ?? 0]);
}

const perMetric = <T>(
  make: (metric: FootprintMetric) => T,
): Record<FootprintMetric, T> =>
  Object.fromEntries(
    footprintMetrics.map((metric) => [metric, make(metric)]),
  ) as Record<FootprintMetric, T>;

/** Median and peak per metric, and the VM headroom at the median and peak memory. */
export function summarizeFootprint(
  samples: FootprintSample[],
  vmMemoryMiB: number,
): FootprintSummary {
  if (samples.length === 0) {
    throw new Error("a footprint run needs at least one sample");
  }
  const summary = perMetric((metric) => {
    const values = samples.map((sample) => sample[metric]);
    return { median: round(median(values), 1), max: Math.max(...values) };
  });
  const free = (memoryMiB: number): number =>
    round(((vmMemoryMiB - memoryMiB) / vmMemoryMiB) * 100, 1);
  return {
    summary,
    headroomPercent: {
      atMedian: free(summary.memoryMiB.median),
      atPeak: free(summary.memoryMiB.max),
    },
  };
}

/** The mean of the run medians per metric, and how far the runs disagree. */
export function footprintBaseline(runs: FootprintSummary[]): FootprintBaseline {
  if (runs.length === 0) {
    throw new Error("a footprint baseline needs at least one run");
  }
  const medians = perMetric((metric) =>
    round(mean(runs.map((run) => run.summary[metric].median)), 1),
  );
  return {
    medians,
    headroomPercent: {
      atMedian: round(mean(runs.map((run) => run.headroomPercent.atMedian)), 1),
      atPeak: round(mean(runs.map((run) => run.headroomPercent.atPeak)), 1),
    },
    spreadPercent: perMetric((metric) => {
      const values = runs.map((run) => run.summary[metric].median);
      const gap = Math.max(...values) - Math.min(...values);
      return medians[metric] === 0
        ? 0
        : round((gap / medians[metric]) * 100, 1);
    }),
  };
}
