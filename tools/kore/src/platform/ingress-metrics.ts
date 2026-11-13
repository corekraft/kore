// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
//
// The pure half of the ingress measurement: parsing the metrics API, summarising
// samples, and the baseline and outcome rules plan 13 states.

export interface PodUsage {
  name: string;
  cpuMillicores: number;
  memoryMiB: number;
}

export interface Spread {
  median: number;
  max: number;
}

export interface MeasurementSummary {
  samples: number;
  cpuMillicores: Spread;
  memoryMiB: Spread;
}

export interface Baseline {
  cpuMillicores: number;
  memoryMiB: number;
}

export type Outcome = "confirmed" | "refuted" | "inconclusive";

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const cpuUnits: Record<string, number> = { n: 1e-6, u: 1e-3, m: 1, "": 1000 };
const memoryUnits: Record<string, number> = {
  Ki: 1 / 1024,
  Mi: 1,
  Gi: 1024,
  "": 1 / 1024 ** 2,
};

function quantity(
  text: string,
  kind: "cpu" | "memory",
  units: Record<string, number>,
): number {
  const match = /^(\d+(?:\.\d+)?)([A-Za-z]{0,2})$/.exec(text);
  const factor = match ? units[match[2] ?? ""] : undefined;
  if (!match || factor === undefined) {
    throw new Error(`unreadable ${kind} quantity ${text}`);
  }
  return Number(match[1]) * factor;
}

interface PodMetricsList {
  items?: {
    metadata?: { name?: string };
    containers?: { usage?: { cpu?: string; memory?: string } }[];
  }[];
}

/**
 * Per-pod CPU (millicores) and memory (MiB) from a metrics.k8s.io PodMetricsList,
 * summing a pod's containers. Same input, same output.
 */
export function parsePodMetrics(json: string): PodUsage[] {
  let list: PodMetricsList;
  try {
    list = JSON.parse(json) as PodMetricsList;
  } catch {
    throw new Error("pod metrics output is not valid JSON");
  }
  return (list.items ?? []).map((item) => {
    let cpu = 0;
    let memory = 0;
    for (const container of item.containers ?? []) {
      cpu += quantity(container.usage?.cpu ?? "0", "cpu", cpuUnits);
      memory += quantity(container.usage?.memory ?? "0", "memory", memoryUnits);
    }
    return {
      name: item.metadata?.name ?? "",
      cpuMillicores: round(cpu, 3),
      memoryMiB: round(memory, 1),
    };
  });
}

function spread(values: number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return { median: round(median, 3), max: round(sorted.at(-1) ?? 0, 3) };
}

/** Median and peak, over samples, of the total across the pods in each sample. */
export function summarizeSamples(samples: PodUsage[][]): MeasurementSummary {
  const total = (pick: (pod: PodUsage) => number) =>
    samples.map((sample) => sample.reduce((sum, pod) => sum + pick(pod), 0));
  return {
    samples: samples.length,
    cpuMillicores: spread(total((pod) => pod.cpuMillicores)),
    memoryMiB: spread(total((pod) => pod.memoryMiB)),
  };
}

/** The baseline: the mean of the runs' medians. */
export function baselineOf(runs: MeasurementSummary[]): Baseline {
  if (runs.length === 0) {
    throw new Error("a baseline needs at least one run");
  }
  const mean = (pick: (run: MeasurementSummary) => number) =>
    round(runs.reduce((sum, run) => sum + pick(run), 0) / runs.length, 3);
  return {
    cpuMillicores: mean((run) => run.cpuMillicores.median),
    memoryMiB: mean((run) => run.memoryMiB.median),
  };
}

/** The medians at or below which a drop of `dropPercent` is reached. */
export function confirmedBelow(
  baseline: Baseline,
  dropPercent: number,
): Baseline {
  const keep = (100 - dropPercent) / 100;
  return {
    cpuMillicores: round(baseline.cpuMillicores * keep, 3),
    memoryMiB: round(baseline.memoryMiB * keep, 3),
  };
}

/**
 * The difference between the highest and lowest run median, as a percentage of
 * the baseline, per metric: how much two identical runs disagree.
 */
export function runSpreadPercent(runs: MeasurementSummary[]): Baseline {
  const baseline = baselineOf(runs);
  const percent = (
    pick: (run: MeasurementSummary) => number,
    base: number,
  ): number => {
    const medians = runs.map(pick);
    return round(
      ((Math.max(...medians) - Math.min(...medians)) / base) * 100,
      1,
    );
  };
  return {
    cpuMillicores: percent(
      (run) => run.cpuMillicores.median,
      baseline.cpuMillicores,
    ),
    memoryMiB: percent((run) => run.memoryMiB.median, baseline.memoryMiB),
  };
}

/**
 * Confirmed when median CPU or median memory drops by at least `dropPercent`
 * from the baseline and by more than the baseline runs' own spread; refuted
 * when neither is lower; inconclusive otherwise.
 */
export function judgeOutcome(
  runs: MeasurementSummary[],
  after: MeasurementSummary,
  dropPercent: number,
): Outcome {
  const baseline = baselineOf(runs);
  const noise = runSpreadPercent(runs);
  const drop = (now: number, base: number) => ((base - now) / base) * 100;
  const cpu = drop(after.cpuMillicores.median, baseline.cpuMillicores);
  const memory = drop(after.memoryMiB.median, baseline.memoryMiB);
  const dropped = (value: number, spreadPercent: number) =>
    value >= dropPercent && value > spreadPercent;
  if (dropped(cpu, noise.cpuMillicores) || dropped(memory, noise.memoryMiB)) {
    return "confirmed";
  }
  return cpu <= 0 && memory <= 0 ? "refuted" : "inconclusive";
}
