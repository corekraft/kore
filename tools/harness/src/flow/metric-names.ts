import { buildReport, type FlowReport } from "./report.js";

/** Report keys that describe the report, not the flow: they are never a hypothesis metric. */
const NOT_METRICS = new Set([
  "version",
  "asOf",
  "scope",
  "minCompletedIdeas",
  "bottleneck",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function walk(value: unknown, prefix: string, found: string[]): void {
  for (const [key, child] of Object.entries(value as object)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (prefix === "" && NOT_METRICS.has(key)) {
      continue;
    }
    if (typeof child === "number" || child === null) {
      found.push(path);
    } else if (isRecord(child)) {
      // A cost metric is one measurement with a status, not its fields.
      if (typeof child["status"] === "string") {
        found.push(path);
      } else {
        walk(child, path, found);
      }
    }
  }
}

/** Dotted paths to every measurement in a flow report, in report order. Lists are per-row detail, so they are skipped. */
export function metricPaths(report: FlowReport): string[] {
  const found: string[] = [];
  walk(report, "", found);
  return found;
}

/** The metrics a harness idea's hypothesis may name: the report's own, read from one built on an empty ledger. */
export function flowMetricNames(): string[] {
  return metricPaths(
    buildReport([], {
      asOf: new Date("2026-01-01T00:00:00.000Z"),
      minCompletedIdeas: 1,
    }),
  );
}
