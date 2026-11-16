import type { CostMetric, FlowReport } from "../flow/index.js";

/** One human line for a per-idea metric: its latest value against the trailing average, or why it has none. */
export function metricLine(
  label: string,
  metric: CostMetric,
  trailing: number,
) {
  if (metric.status === "insufficient history") {
    return `${label}: insufficient history, ${metric.closedIdeas} of ${metric.needed} closed ideas`;
  }
  const average = Math.round(metric.trailingAverage * 100) / 100;
  return `${label}: ${metric.currentIdea} ${metric.current}, average of the ${trailing} ideas before it ${average}${metric.worsened ? " (worsened)" : ""}`;
}

const REWORK_LABELS = {
  escalationsPerIdea: "Escalations per idea",
  sendBacksPerIdea: "Send-backs per idea",
  frictionPerIdea: "Friction events per idea",
} as const;

/** One line per rework metric, in the order the report lists them. */
export const reworkLines = (rework: FlowReport["rework"]) =>
  Object.entries(REWORK_LABELS).map(([key, label]) =>
    metricLine(
      label,
      rework[key as keyof typeof REWORK_LABELS],
      rework.trailingIdeas,
    ),
  );

/** The friction total with its sources, and how many unknown record kinds were ignored. */
export function frictionLine({
  total,
  sources,
  unknownKinds,
}: FlowReport["friction"]) {
  const ignored =
    unknownKinds === 0 ? "" : `; ${unknownKinds} unknown kind(s) ignored`;
  return total === 0
    ? `Friction: none${ignored}`
    : `Friction: ${total} (${sources.map((s) => `${s.source} ${s.events}`).join(", ")})${ignored}`;
}
