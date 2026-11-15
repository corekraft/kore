import type { CostMetric, FlowReport } from "../flow/index.js";

type Named = { name: string; idea: string; worsened: boolean };

const isMetric = (value: unknown): value is CostMetric =>
  typeof value === "object" && value !== null && "status" in value;

/**
 * The flow report's trailing metrics that have enough history, each with the
 * idea its latest value measures. A metric without history is left out.
 */
export function metricsOf(report: FlowReport): Named[] {
  return [...Object.entries(report.metrics), ...Object.entries(report.rework)]
    .filter((entry): entry is [string, CostMetric] => isMetric(entry[1]))
    .flatMap(([name, metric]) =>
      metric.status === "ok"
        ? [{ name, idea: metric.currentIdea, worsened: metric.worsened }]
        : [],
    );
}
