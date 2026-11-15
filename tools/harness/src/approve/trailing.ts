import type { CostMetric, FlowReport } from "../flow/index.js";

const isTrailing = (value: unknown): value is CostMetric =>
  typeof value === "object" &&
  value !== null &&
  "status" in value &&
  ((value as { status: unknown }).status === "ok" ||
    (value as { status: unknown }).status === "insufficient history");

/** The report's trailing metrics by dotted path, the way a hypothesis names them. */
export function trailingOf(report: FlowReport): Record<string, CostMetric> {
  const found: Record<string, CostMetric> = {};
  for (const group of ["metrics", "rework"] as const) {
    for (const [name, value] of Object.entries(report[group])) {
      if (isTrailing(value)) {
        found[`${group}.${name}`] = value;
      }
    }
  }
  return found;
}
